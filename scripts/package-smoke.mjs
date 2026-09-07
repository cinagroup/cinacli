import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, 'artifacts');
const sandboxRoot = join(root, '.test-tmp');
await mkdir(artifacts, { recursive: true });
await mkdir(sandboxRoot, { recursive: true });
const installation = await mkdtemp(join(sandboxRoot, 'package-'));
const manager = process.env.npm_execpath;
assert.ok(manager, 'Run with pnpm test:package');
const executable = /\.exe$/i.test(manager) ? manager : process.execPath;
const prefix = executable === process.execPath ? [manager] : [];
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('CINA_')) delete env[key];
env.CINA_CONFIG_DIR = join(installation, 'config');

async function pnpm(args, overrides = {}) {
  return execute(executable, [...prefix, ...args], { cwd: root, env: { ...env, ...overrides }, maxBuffer: 4 * 1024 * 1024 });
}

try {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const archive = join(artifacts, `cinagroup-cli-${manifest.version}.tgz`);
  const packed = JSON.parse((await pnpm(['pack', '--config.ignore-scripts=true', '--out', archive, '--json'])).stdout);
  assert.ok(packed.files.some(file => file.path === 'dist/bin.js'));
  assert.ok(packed.files.every(file => /^(dist\/|docs\/|README\.md$|package\.json$)/.test(file.path)));
  await writeFile(join(installation, 'package.json'), JSON.stringify({ name: 'cinacli-package-smoke', private: true, type: 'module' }));
  await pnpm(['--dir', installation, 'add', archive, '--offline', '--ignore-scripts', '--no-lockfile']);
  async function cina(args, overrides) {
    return JSON.parse((await pnpm(['--dir', installation, 'exec', 'cina', ...args, '--json'], overrides)).stdout);
  }
  assert.equal((await cina(['--version'])).data.version, packed.version);
  assert.equal((await cina(['--help'], { CINA_CONFIG_DIR: 'deliberately-invalid' })).ok, true);
  const schema = await cina(['schema'], { CINA_CONFIG_DIR: 'deliberately-invalid' });
  assert.equal(schema.ok, true);
  assert.equal((await cina(['context', 'create', 'staging'])).ok, true);
  assert.equal((await cina(['context', 'use', 'staging'])).ok, true);
  assert.equal((await cina(['config', 'set', 'chain.chainId', '84532'])).data.context.products.chain.chainId, 84532);
  console.log(JSON.stringify({ ok: true, archive, platform: process.platform, commands: schema.data.commands.length, files: packed.files.length }));
} finally {
  // Only remove the directory created by this script, below the fixed workspace test root.
  const target = resolve(installation);
  assert.equal(dirname(target), resolve(sandboxRoot));
  assert.ok(target.startsWith(`${resolve(sandboxRoot)}${sep}`));
  await rm(target, { recursive: true, force: true });
}
