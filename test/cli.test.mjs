import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { runCli } from '../dist/cli.js';
import { commandRegistry } from '../dist/core/commands.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cinacli-contract-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('cinacli-contract-'));
    return rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function run(directory, args, extra = {}) {
  let stdout = '', stderr = '';
  const exitCode = await runCli(args, {
    env: { CINA_CONFIG_DIR: directory, ...extra.env },
    io: { out: text => { stdout += text; }, err: text => { stderr += text; }, isTTY: false },
    store: { get: async () => { throw new Error('private-backend-detail'); } },
    ...extra.options,
  });
  return { exitCode, stdout, stderr, json: args.includes('--json') ? JSON.parse(stdout) : null };
}

test('help, version and schema work without config, network or native credentials', async t => {
  const directory = join(await fixture(t), 'not-created');
  let storeReads = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network must not be used'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  for (const args of [['--help'], ['--version'], ['schema'], ['schema', 'config.set']]) {
    const result = await run(directory, [...args, '--json'], {
      env: { CINA_CONFIG_DIR: 'invalid-relative-path' },
      options: { store: { get: async () => { storeReads++; throw new Error('must not load'); } } },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.json.ok, true);
    assert.equal(result.stderr, '');
  }
  assert.equal(storeReads, 0);
  await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('schema lists exactly implemented commands and defines input/output/effects', async t => {
  const result = await run(await fixture(t), ['schema', '--json']);
  assert.deepEqual(result.json.data.commands.map(item => item.command), commandRegistry().map(item => item.id));
  for (const command of result.json.data.commands) {
    assert.equal(command.inputSchema.type, 'object');
    assert.equal(command.outputSchema.type, 'object');
    assert.equal(command.inputSchema.additionalProperties, false);
    assert.equal(command.streaming, false);
    assert.deepEqual(command.authentication, []);
  }
  assert.ok(!result.stdout.includes('token.models.list'));
});

test('invalid arguments produce one sanitized JSON failure with exit 2', async t => {
  const directory = await fixture(t);
  const cases = [
    ['context', 'create'], ['context', 'create', 'two words'],
    ['context', 'create', 'ok', 'extra'], ['config', 'set', 'token.secret', 'private-secret'],
    ['context', 'list', '--product', 'shop'], ['doctor', '--product', 'unknown'],
    ['schema', '--timeout', 'NaN'], ['schema', '--timeout', '-1'],
    ['--timeout', '301', '--help'], ['schema', '--unknown', 'private-secret'],
    ['schema', '--context', 'a', '--context', 'b'], ['schema', '--json'],
    ['--version', 'extra'], ['schema', '--json=true'],
  ];
  for (const args of cases) {
    const result = await run(directory, [...args, '--json']);
    assert.equal(result.exitCode, 2, args.join(' '));
    assert.equal(result.json.ok, false);
    assert.equal(result.json.error.code, 'INVALID_ARGUMENT');
    assert.equal(result.stderr, '');
    assert.ok(!result.stdout.includes('private-secret'));
  }
});

test('unknown product commands are errors, not fabricated empty success', async t => {
  const directory = await fixture(t);
  assert.equal((await run(directory, ['token', 'models', 'list', '--json'])).exitCode, 2);
  const result = await run(directory, ['schema', 'token.models.list', '--json']);
  assert.equal(result.exitCode, 8);
  assert.equal(result.json.error.code, 'CAPABILITY_UNAVAILABLE');
});

test('contexts require explicit selection, preserve precedence and persist no env secrets', async t => {
  const directory = await fixture(t);
  assert.equal((await run(directory, ['context', 'show', '--json'])).exitCode, 2);
  for (const name of ['staging', 'production']) {
    assert.equal((await run(directory, ['context', 'create', name, '--json'])).exitCode, 0);
  }
  assert.equal((await run(directory, ['context', 'list', '--json'])).json.data.current, null);
  assert.equal((await run(directory, ['context', 'create', 'staging', '--json'])).exitCode, 6);
  assert.equal((await run(directory, ['context', 'use', 'missing', '--json'])).exitCode, 2);
  await run(directory, ['context', 'use', 'staging', '--json']);
  await run(directory, ['config', 'set', 'token.endpoint', 'https://token.example.test/', '--json'], { env: { CINA_TOKEN_GATEWAY_KEY: 'private-secret' } });
  const result = await run(directory, ['context', 'show', '--context', 'staging', '--json'], { env: { CINA_CONTEXT: 'production' } });
  assert.equal(result.json.context.name, 'staging');
  assert.equal(result.json.data.context.products.token.endpoint, 'https://token.example.test');
  assert.equal((await run(directory, ['context', 'show', '--json'], { env: { CINA_CONTEXT: 'production' } })).json.context.name, 'production');
  assert.equal((await run(directory, ['context', 'show', '--json'])).json.context.name, 'staging');
  const saved = await readFile(join(directory, 'config.json'), 'utf8');
  assert.ok(!saved.includes('private-secret'));
  assert.ok(!result.stdout.includes('credentialEpochs'));
});

test('endpoint and integer config validation reject credentials, remote plaintext and invalid values', async t => {
  const directory = await fixture(t);
  await run(directory, ['context', 'create', 'local', '--json']);
  await run(directory, ['context', 'use', 'local', '--json']);
  for (const endpoint of ['http://remote.example.test', 'https://user:private-secret@host.test', 'https://host.test?key=private-secret', 'https://host.test/#private-secret', 'file:///tmp/test']) {
    const result = await run(directory, ['config', 'set', 'token.endpoint', endpoint, '--json']);
    assert.equal(result.exitCode, 2);
    assert.ok(!result.stdout.includes('private-secret'));
  }
  for (const id of ['0', '-1', '0x14a34', '1.5', '9007199254740992']) {
    assert.equal((await run(directory, ['config', 'set', 'chain.chainId', id, '--json'])).exitCode, 2);
  }
  assert.equal((await run(directory, ['config', 'set', 'chain.chainId', '84532', '--json'])).exitCode, 0);
  assert.equal((await run(directory, ['config', 'set', 'chain.endpoint', 'http://127.0.0.1:8545', '--json'])).exitCode, 0);
});

test('invalid config and concurrent writer never overwrite the file', async t => {
  const directory = await fixture(t);
  const configPath = join(directory, 'config.json');
  const invalid = '{"version":99,"secret":"private-secret"}';
  await writeFile(configPath, invalid);
  const result = await run(directory, ['context', 'create', 'staging', '--json']);
  assert.equal(result.exitCode, 2);
  assert.equal(result.json.error.code, 'CONFIG_INVALID');
  assert.ok(!result.stdout.includes('private-secret'));
  assert.equal(await readFile(configPath, 'utf8'), invalid);
  await rm(configPath);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'config.lock'), '');
  assert.equal((await run(directory, ['context', 'create', 'staging', '--json'])).exitCode, 6);
  await access(join(directory, 'config.lock'));
  await assert.rejects(access(configPath), { code: 'ENOENT' });
});

test('doctor reports missing adapters and unavailable keyring without claiming auth or leaking errors', async t => {
  const result = await run(await fixture(t), ['doctor', '--product', 'shop', '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.json.data.status, 'attention');
  assert.equal(result.json.data.credentialStore, 'unavailable');
  assert.deepEqual(result.json.data.checks, [{ product: 'shop', configuration: 'not-configured', connectivity: 'not-checked', adapter: 'not-implemented', authorization: 'unknown' }]);
  assert.ok(!result.stdout.includes('private-backend-detail'));
});
