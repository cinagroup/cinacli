import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { PassThrough } from 'node:stream';
import { runCli } from '../dist/cli.js';
import { readSecretInput } from '../dist/core/secret-input.js';
import { CliError } from '../dist/core/errors.js';

const gatewayKey = 'synthetic-gateway-key';
const managementKey = 'synthetic-management-key';
const account = { workspace_id: 'workspace-1', budget_max: null, budget_spent: 0.0000001, budget_period: 'monthly', budget_reset_at: '2026-10-01T00:00:00Z', billing_currency: 'USD', metadata: { secret: 'private-metadata' } };
const workspace = { id: 'workspace-1', name: 'Example', slug: 'example', description: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', secret: 'private-field' };
const address = '0x0000000000000000000000000000000000000001';

async function fixture(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), 'cinacli-products-'));
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = { url: new URL(req.url, 'http://local.test'), method: req.method, authorization: req.headers.authorization, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null };
    requests.push(request);
    handler(request, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('cinacli-products-'));
    await rm(directory, { recursive: true, force: true });
  });
  const secrets = new Map();
  const store = { get: async key => secrets.get(key), set: async (key, value) => { secrets.set(key, value); }, remove: async key => secrets.delete(key) };
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  async function run(args, env = {}, overrides = {}) {
    let stdout = '', stderr = '';
    const code = await runCli([...args, '--json'], { env: { CINA_CONFIG_DIR: directory, ...env }, store,
      io: { out: text => { stdout += text; }, err: text => { stderr += text; }, isTTY: false }, ...overrides });
    assert.equal(stderr, '');
    assert.ok(!stdout.includes(gatewayKey) && !stdout.includes(managementKey));
    return { code, body: JSON.parse(stdout), stdout };
  }
  await run(['context', 'create', 'staging']);
  await run(['context', 'use', 'staging']);
  await run(['config', 'set', 'token.endpoint', endpoint]);
  await run(['config', 'set', 'chain.endpoint', endpoint]);
  await run(['config', 'set', 'chain.chainId', '84532']);
  return { run, requests, secrets, endpoint, directory, store };
}

function tokenServer(request, res) {
  const management = request.url.pathname === '/api/v1/workspaces';
  if (request.authorization !== `Bearer ${management ? managementKey : gatewayKey}`) {
    res.writeHead(401).end(JSON.stringify({ error: { message: 'private-auth-error' } })); return;
  }
  if (request.url.pathname === '/v1/me') res.end(JSON.stringify(account));
  else if (management) res.end(JSON.stringify({ data: [workspace], total_count: 3 }));
  else if (request.url.pathname === '/v1/models') res.end(JSON.stringify({ object: 'list', data: [{ id: 'model-1', object: 'model', owned_by: 'cinatoken', secret: 'private-field' }] }));
  else res.writeHead(404).end();
}

test('Token lists preserve filters/defaults and use the Gateway credential only', async t => {
  const { run, requests } = await fixture(t, tokenServer);
  const env = { CINA_TOKEN_GATEWAY_KEY: gatewayKey, CINA_TOKEN_MANAGEMENT_KEY: managementKey };
  const defaults = await run(['token', 'models', 'list'], env);
  assert.equal(defaults.code, 0);
  assert.equal(requests[0].url.search, '');
  assert.deepEqual(defaults.body.data.items, [{ id: 'model-1', ownedBy: 'cinatoken', info: null }]);
  assert.deepEqual(defaults.body.meta.pagination, { mode: 'none' });
  const filtered = await run(['token', 'models', 'list', '--kind', 'embedding', '--route-groups', 'default,free'], env);
  assert.equal(filtered.code, 0);
  assert.equal(requests[1].url.searchParams.get('kind'), 'embedding');
  assert.equal(requests[1].url.searchParams.get('route_groups'), 'default,free');
  assert.equal(requests[1].authorization, `Bearer ${gatewayKey}`);
  const count = requests.length;
  for (const args of [['--kind', 'made-up'], ['--page', '2'], ['--route-groups', '']]) assert.equal((await run(['token', 'models', 'list', ...args], env)).code, 2);
  assert.equal(requests.length, count);
});

test('Token account budgets retain unknown maximum and decimal values without metadata leakage', async t => {
  const { run } = await fixture(t, tokenServer);
  const result = await run(['token', 'account', 'show'], { CINA_TOKEN_GATEWAY_KEY: gatewayKey });
  assert.equal(result.code, 0);
  assert.equal(result.body.data.workspaceId, 'workspace-1');
  assert.equal(result.body.data.budget.maximum, null);
  assert.equal(result.body.data.budget.spent, '0.0000001');
  assert.equal(result.body.data.budget.currency, 'USD');
  assert.ok(!result.stdout.includes('private-metadata'));
});

test('Management pagination is explicit and cannot fall back to a Gateway key', async t => {
  const { run, requests } = await fixture(t, tokenServer);
  const missing = await run(['token', 'workspaces', 'list'], { CINA_TOKEN_GATEWAY_KEY: gatewayKey });
  assert.equal(missing.code, 3);
  assert.equal(requests.length, 0);
  const wrong = await run(['token', 'workspaces', 'list'], { CINA_TOKEN_MANAGEMENT_KEY: gatewayKey });
  assert.equal(wrong.code, 3);
  assert.ok(!wrong.stdout.includes('private-auth-error'));
  const result = await run(['token', 'workspaces', 'list', '--offset', '1', '--limit', '1'], { CINA_TOKEN_MANAGEMENT_KEY: managementKey });
  assert.equal(result.code, 0);
  assert.equal(requests.at(-1).url.searchParams.get('offset'), '1');
  assert.equal(requests.at(-1).url.searchParams.get('limit'), '1');
  assert.deepEqual(result.body.meta.pagination, { mode: 'offset', offset: 1, limit: 1, total: 3, hasMore: true, nextOffset: 2 });
  assert.ok(!result.stdout.includes('private-field'));
});

test('configured Gateway workspace mismatch fails before listing models', async t => {
  const { run, requests } = await fixture(t, tokenServer);
  await run(['config', 'set', 'token.workspaceId', 'different']);
  const result = await run(['token', 'models', 'list'], { CINA_TOKEN_GATEWAY_KEY: gatewayKey });
  assert.equal(result.code, 6);
  assert.deepEqual(requests.map(item => item.url.pathname), ['/v1/me']);
});

test('product response mismatch cannot masquerade as an empty collection', async t => {
  const { run } = await fixture(t, (_req, res) => res.end('{"data":{},"object":"list"}'));
  const result = await run(['token', 'models', 'list'], { CINA_TOKEN_GATEWAY_KEY: gatewayKey });
  assert.equal(result.code, 8);
  assert.equal(result.body.error.code, 'UPSTREAM_CONTRACT_MISMATCH');
});

test('Token login validates before saving, keeps schemes separate and logout only clears local credentials', async t => {
  const { run, secrets, requests } = await fixture(t, tokenServer);
  for (const credential of ['gateway', 'management']) {
    const result = await run(['login', '--product', 'token', '--credential', credential], credential === 'gateway' ? { CINA_TOKEN_GATEWAY_KEY: gatewayKey } : { CINA_TOKEN_MANAGEMENT_KEY: managementKey });
    assert.equal(result.code, 0);
    assert.equal(result.body.data.saved, true);
  }
  assert.equal(secrets.size, 2);
  const saved = [...secrets.entries()];
  assert.equal((await run(['login', '--product', 'token', '--credential', 'gateway'], { CINA_TOKEN_GATEWAY_KEY: 'invalid-key' })).code, 3);
  assert.deepEqual([...secrets.entries()], saved);
  assert.equal((await run(['token', 'account', 'show'])).code, 0);
  assert.equal((await run(['token', 'workspaces', 'list'])).code, 0);
  const count = requests.length;
  const loggedOut = await run(['logout', '--product', 'token', '--credential', 'gateway'], { CINA_TOKEN_GATEWAY_KEY: gatewayKey });
  assert.equal(loggedOut.code, 0);
  assert.equal(loggedOut.body.data.remoteRevocation, 'not-requested');
  assert.equal(loggedOut.body.data.environmentCredentialsPresent, true);
  assert.equal(requests.length, count);
  assert.equal(secrets.size, 1);
  assert.equal((await run(['token', 'account', 'show'])).code, 3);
});

test('explicit stdin and no-store login work without keyring; ambiguous input is rejected', async t => {
  const { run, requests } = await fixture(t, tokenServer);
  const overrides = { readSecret: async () => gatewayKey, store: { get: async () => { throw new Error('unavailable'); }, set: async () => { throw new Error('must not save'); } } };
  const result = await run(['login', '--product', 'token', '--credential', 'gateway', '--token-stdin', '--no-store'], {}, overrides);
  assert.equal(result.code, 0);
  assert.equal(result.body.data.saved, false);
  const count = requests.length;
  assert.equal((await run(['login', '--product', 'token', '--credential', 'gateway', '--token-stdin'], { CINA_TOKEN_GATEWAY_KEY: gatewayKey }, overrides)).code, 2);
  assert.equal(requests.length, count);
  assert.equal((await run(['login'])).code, 3);
});

test('Token in-flight login excludes logout and competing login, then permits complete logout', async t => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { run, secrets, requests } = await fixture(t, (req, res) => {
    release = () => tokenServer(req, res); entered();
  });
  const pending = run(['login', '--product', 'token', '--credential', 'gateway'], { CINA_TOKEN_GATEWAY_KEY: gatewayKey });
  await started;
  try {
    assert.equal((await run(['logout', '--product', 'token'])).code, 6);
    assert.equal((await run(['login', '--product', 'token', '--credential', 'gateway'], { CINA_TOKEN_GATEWAY_KEY: gatewayKey })).code, 6);
    assert.equal(requests.length, 1);
  } finally { release(); await pending; }
  assert.equal(secrets.size, 1);
  assert.equal((await run(['logout', '--product', 'token'])).code, 0); assert.equal(secrets.size, 0);
});

test('Token combined logout acquires both locks before clearing either credential and cancellation releases the login lock', async t => {
  let hold = false;
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { run, secrets } = await fixture(t, (req, res) => {
    if (hold) { release = () => tokenServer(req, res); entered(); }
    else tokenServer(req, res);
  });
  for (const credential of ['gateway', 'management']) assert.equal((await run(['login', '--product', 'token', '--credential', credential], {
    CINA_TOKEN_GATEWAY_KEY: gatewayKey, CINA_TOKEN_MANAGEMENT_KEY: managementKey,
  })).code, 0);
  assert.equal(secrets.size, 2);
  hold = true;
  const controller = new AbortController();
  const pending = run(['login', '--product', 'token', '--credential', 'management'], { CINA_TOKEN_MANAGEMENT_KEY: managementKey }, { signal: controller.signal });
  await started;
  try {
    assert.equal((await run(['logout', '--product', 'token'])).code, 6);
    assert.equal(secrets.size, 2, 'No credential may be removed before every selected lock is acquired');
  } finally { controller.abort(); release(); }
  assert.equal((await pending).code, 130);
  assert.equal((await run(['logout', '--product', 'token'])).code, 0); assert.equal(secrets.size, 0);
});

test('Chain checks network first, pins balance block and preserves values larger than Number.MAX_SAFE_INTEGER', async t => {
  const value = (2n ** 70n) + 1n;
  const { run, requests } = await fixture(t, (req, res) => {
    const result = { eth_chainId: '0x14a34', eth_blockNumber: '0xabcdef', eth_getBalance: `0x${value.toString(16)}` }[req.body.method];
    res.end(JSON.stringify({ jsonrpc: '2.0', id: req.body.id, result }));
  });
  const result = await run(['chain', 'balance', '--address', address]);
  assert.equal(result.code, 0);
  assert.equal(result.body.data.network.chainId, '84532');
  assert.equal(result.body.data.network.testnet, true);
  assert.equal(result.body.data.block.number, '11259375');
  assert.equal(result.body.data.balance.value, value.toString());
  assert.equal(result.body.data.balance.formatted, '1180.591620717411303425');
  assert.deepEqual(requests.map(req => req.body.method), ['eth_chainId', 'eth_blockNumber', 'eth_getBalance']);
  assert.deepEqual(requests.at(-1).body.params, [address, '0xabcdef']);
  assert.ok(requests.every(req => !Array.isArray(req.body) && !req.authorization));
});

test('Chain rejects wrong networks, bad IDs, ambiguous responses and provider errors', async t => {
  let mode = 'network';
  const { run, requests } = await fixture(t, (req, res) => {
    let response = { jsonrpc: '2.0', id: req.body.id, result: '0x14a34' };
    if (mode === 'network') response.result = '0x1';
    if (mode === 'id') response.id = 'another-request';
    if (mode === 'ambiguous') response.error = { code: -32601, message: 'private-provider-message' };
    if (mode === 'error') response = { jsonrpc: '2.0', id: req.body.id, error: { code: -32601, message: 'private-provider-message' } };
    if (mode === 'quantity') response.result = '0x00';
    res.end(JSON.stringify(response));
  });
  for (const [next, expected] of [['network', 6], ['id', 8], ['ambiguous', 8], ['error', 8], ['quantity', 8]]) {
    mode = next;
    const count = requests.length;
    const result = await run(['chain', 'status']);
    assert.equal(result.code, expected);
    assert.equal(requests.length, count + 1);
    assert.ok(!result.stdout.includes('private-provider-message'));
  }
});

test('Chain rejects malformed addresses before requests and keeps unknown network metadata unknown', async t => {
  const { run, requests } = await fixture(t, (req, res) => res.end(JSON.stringify({ jsonrpc: '2.0', id: req.body.id, result: req.body.method === 'eth_chainId' ? '0x539' : '0x0' })));
  assert.equal((await run(['chain', 'balance', '--address', '0x123'])).code, 2);
  assert.equal(requests.length, 0);
  await run(['config', 'set', 'chain.chainId', '1337']);
  const result = await run(['chain', 'balance', '--address', address]);
  assert.equal(result.code, 0);
  assert.equal(result.body.data.network.nativeCurrency, null);
  assert.equal(result.body.data.network.testnet, null);
  assert.equal(result.body.data.balance.formatted, null);
});

test('secret pipe input is bounded, trims one line ending and supports cancellation', async () => {
  const stream = new PassThrough();
  const input = readSecretInput(stream, new AbortController().signal);
  stream.end(`${gatewayKey}\r\n`);
  assert.equal(await input, gatewayKey);
  const large = new PassThrough();
  const rejection = assert.rejects(readSecretInput(large, new AbortController().signal), { code: 'INVALID_ARGUMENT' });
  large.end('x'.repeat(20_000));
  await rejection;
  const waiting = new PassThrough();
  const controller = new AbortController();
  const cancelled = assert.rejects(readSecretInput(waiting, controller.signal), { code: 'CANCELLED' });
  controller.abort(new CliError('CANCELLED'));
  await cancelled;
});
