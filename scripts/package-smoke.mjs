import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

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

async function pnpm(args, overrides = {}, stdin = '') {
  const execution = execute(executable, [...prefix, ...args], { cwd: root, env: { ...env, ...overrides }, maxBuffer: 4 * 1024 * 1024 });
  execution.child.stdin.end(stdin);
  return execution;
}

const syntheticKey = 'package-smoke-synthetic-key';
const rpcMethods = [];
const server = createServer(async (req, res) => {
  if (req.url === '/.well-known/openid-configuration') {
    const base = `http://127.0.0.1:${server.address().port}`;
    return res.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/authorize`, jwks_uri: `${base}/jwks`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] }));
  }
  if (req.url.startsWith('/outapi/product/list')) {
    if (req.headers.authorization !== `Bearer ${syntheticKey}`) return res.writeHead(401).end();
    return res.end(JSON.stringify({ status: 200, data: { list: [{ id: 1, store_name: 'Sample', image: '', price: '1.25', stock: 2 }], count: 1 } }));
  }
  if (req.url === '/v1/me') {
    if (req.headers.authorization !== `Bearer ${syntheticKey}`) return res.writeHead(401).end();
    return res.end(JSON.stringify({ workspace_id: 'smoke', budget_max: null, budget_spent: 1.5, budget_period: 'monthly', budget_reset_at: null, billing_currency: 'USD' }));
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (req.url === '/outapi/get_token') {
    if (body.appid !== 'smoke-app' || body.appsecret !== syntheticKey) return res.writeHead(401).end();
    return res.end(JSON.stringify({ status: 200, data: { access_token: syntheticKey, exp_time: Math.floor(Date.now() / 1000) + 3600, auth_info: { id: 1, appid: 'smoke-app' } } }));
  }
  rpcMethods.push(body.method);
  const result = { eth_chainId: '0x14a34', eth_blockNumber: '0x123', eth_getBalance: '0x10000000000000001' }[body.method];
  res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const archive = join(artifacts, `cinagroup-cli-${manifest.version}.tgz`);
  const packed = JSON.parse((await pnpm(['pack', '--config.ignore-scripts=true', '--out', archive, '--json'])).stdout);
  assert.ok(packed.files.some(file => file.path === 'dist/bin.js'));
  assert.ok(packed.files.every(file => /^(dist\/|docs\/|README\.md$|package\.json$)/.test(file.path)));
  await writeFile(join(installation, 'package.json'), JSON.stringify({ name: 'cinacli-package-smoke', private: true, type: 'module' }));
  await pnpm(['--dir', installation, 'add', archive, '--offline', '--ignore-scripts', '--no-lockfile']);
  async function cina(args, overrides, stdin) {
    const stdout = (await pnpm(['--dir', installation, 'exec', 'cina', ...args, '--json'], overrides, stdin)).stdout;
    assert.ok(!stdout.includes(syntheticKey));
    return JSON.parse(stdout);
  }
  assert.equal((await cina(['--version'])).data.version, packed.version);
  assert.equal((await cina(['--help'], { CINA_CONFIG_DIR: 'deliberately-invalid' })).ok, true);
  const schema = await cina(['schema'], { CINA_CONFIG_DIR: 'deliberately-invalid' });
  assert.equal(schema.ok, true);
  assert.equal((await cina(['context', 'create', 'staging'])).ok, true);
  assert.equal((await cina(['context', 'use', 'staging'])).ok, true);
  assert.equal((await cina(['config', 'set', 'chain.chainId', '84532'])).data.context.products.chain.chainId, 84532);
  await cina(['config', 'set', 'chain.endpoint', endpoint]);
  const balance = await cina(['chain', 'balance', '--address', '0x0000000000000000000000000000000000000000']);
  assert.equal(balance.data.balance.value, '18446744073709551617');
  assert.deepEqual(rpcMethods, ['eth_chainId', 'eth_blockNumber', 'eth_getBalance']);
  await cina(['config', 'set', 'token.endpoint', endpoint]);
  assert.equal((await cina(['token', 'account', 'show'], { CINA_TOKEN_GATEWAY_KEY: syntheticKey })).data.budget.spent, '1.5');
  const login = await cina(['login', '--product', 'token', '--credential', 'gateway', '--token-stdin', '--no-store'], {}, `${syntheticKey}\r\n`);
  assert.equal(login.data.validated, true);
  assert.equal(login.data.saved, false);
  assert.equal(login.data.source, 'stdin');
  await cina(['config', 'set', 'auth.issuer', endpoint]);
  assert.equal((await cina(['auth', 'status'])).data.discovery, 'validated');
  await cina(['config', 'set', 'shop.endpoint', endpoint]);
  assert.equal((await cina(['shop', 'products', 'list'], { CINA_SHOP_ACCESS_TOKEN: syntheticKey })).data.items[0].price, '1.25');
  const shopLogin = await cina(['login', '--product', 'shop', '--secret-stdin', '--no-store'], { CINA_SHOP_APP_ID: 'smoke-app' }, `${syntheticKey}\n`);
  assert.equal(shopLogin.data.saved, false);
  assert.equal(shopLogin.data.principal, '1');
  console.log(JSON.stringify({ ok: true, archive, platform: process.platform, commands: schema.data.commands.length, files: packed.files.length }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  // Only remove the directory created by this script, below the fixed workspace test root.
  const target = resolve(installation);
  assert.equal(dirname(target), resolve(sandboxRoot));
  assert.ok(target.startsWith(`${resolve(sandboxRoot)}${sep}`));
  await rm(target, { recursive: true, force: true });
}
