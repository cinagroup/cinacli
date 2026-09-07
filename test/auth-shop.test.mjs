import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { runCli } from '../dist/cli.js';

const secret = 'synthetic-app-secret';
const token = 'synthetic-out-token';
const nextToken = 'synthetic-next-token';
const product = { id: 123, store_name: 'Product', image: '/product.png', price: '12345678901234567890.25', stock: 9, description: 'private-description', attrs: [{ cost: 'private-cost' }] };
const order = { id: 10, order_id: 'ORDER-10', status: 1, status_name: '待收货', paid: 1, total_num: 2, total_price: '100.00', pay_price: '98.50', add_time: 1788739200, pay_time: 0,
  real_name: 'private-name', user_phone: 'private-phone', user_address: 'private-address', invoice: { card_number: 'private-bank' }, items: [{ secret: 'private-item' }] };
const expires = () => Math.floor(Date.now() / 1000) + 3600;

async function fixture(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), 'cinacli-auth-shop-'));
  const requests = [];
  const secrets = new Map();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = { url: new URL(req.url, 'http://local.test'), method: req.method, authorization: req.headers.authorization, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null };
    requests.push(request);
    await handler(request, res, endpoint);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/service`;
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('cinacli-auth-shop-'));
    await rm(directory, { recursive: true, force: true });
  });
  const store = { get: async key => secrets.get(key), set: async (key, value) => { secrets.set(key, value); }, remove: async key => secrets.delete(key) };
  async function run(args, env = {}, options = {}) {
    let stdout = '', stderr = '';
    const code = await runCli([...args, '--json'], { env: { CINA_CONFIG_DIR: directory, ...env }, store,
      io: { out: text => { stdout += text; }, err: text => { stderr += text; }, isTTY: false }, ...options });
    assert.equal(stderr, '');
    for (const value of [secret, token, nextToken, 'private-']) assert.ok(!stdout.includes(value), 'output must not leak undeclared fields or credentials');
    return { code, body: JSON.parse(stdout) };
  }
  await run(['context', 'create', 'staging']); await run(['context', 'use', 'staging']);
  await run(['config', 'set', 'auth.issuer', endpoint]); await run(['config', 'set', 'shop.endpoint', endpoint]);
  return { directory, run, requests, secrets, endpoint };
}

function metadata(endpoint) {
  return { issuer: endpoint, authorization_endpoint: `${endpoint}/authorize`, token_endpoint: `${endpoint}/token`, userinfo_endpoint: `${endpoint}/userinfo`, jwks_uri: `${endpoint}/jwks`,
    response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['openid', 'profile'], extra: 'private-field' };
}

test('Auth status validates discovery at issuer path without credentials or visiting advertised endpoints', async t => {
  const { run, requests, endpoint } = await fixture(t, (_req, res, base) => res.end(JSON.stringify(metadata(base))));
  await run(['config', 'set', 'auth.clientId', 'registered-elsewhere']);
  const result = await run(['auth', 'status'], { CINA_SHOP_ACCESS_TOKEN: token });
  assert.equal(result.code, 0); assert.equal(result.body.data.issuer, endpoint);
  assert.deepEqual(result.body.data.client, { configured: true, registration: 'not-verified' });
  assert.equal(result.body.data.login, 'browser-pkce');
  assert.equal(result.body.data.advertised.pkceS256, true);
  assert.equal(result.body.data.advertised.publicClient, true);
  assert.equal(requests.length, 1); assert.equal(requests[0].url.pathname, '/service/.well-known/openid-configuration');
  assert.equal(requests[0].authorization, undefined);
});

test('Auth rejects mismatched issuer, unsafe advertised URLs and invalid OIDC metadata', async t => {
  let mode = 'issuer';
  const { run, requests } = await fixture(t, (_req, res, base) => {
    const body = metadata(base);
    if (mode === 'issuer') body.issuer += '/another';
    if (mode === 'plaintext') body.token_endpoint = 'http://remote.example/token';
    if (mode === 'userinfo') body.jwks_uri = 'https://name:private-key@example.com/jwks';
    if (mode === 'query') body.userinfo_endpoint += '?key=private-query';
    if (mode === 'missing') delete body.id_token_signing_alg_values_supported;
    res.end(JSON.stringify(body));
  });
  for (const [value, code] of [['issuer', 6], ['plaintext', 8], ['userinfo', 8], ['query', 8], ['missing', 8]]) {
    mode = value; assert.equal((await run(['auth', 'status'])).code, code);
  }
  assert.equal(requests.length, 5);
});

test('Shop product lists/details preserve decimal strings, route prefix and server pagination', async t => {
  const { run, requests } = await fixture(t, (req, res) => res.end(JSON.stringify({ status: 200, data: req.url.pathname.endsWith('/list') ? { list: [product], count: 3 } : product })));
  const env = { CINA_SHOP_ACCESS_TOKEN: token };
  const result = await run(['shop', 'products', 'list', '--name', 'Sample', '--page', '2', '--limit', '1'], env);
  assert.equal(result.code, 0); assert.equal(result.body.data.items[0].price, product.price);
  assert.equal(result.body.data.items[0].currency, null);
  assert.deepEqual(result.body.meta.pagination, { mode: 'page', page: 2, limit: 1, total: 3, hasMore: true, nextPage: 3 });
  assert.equal(requests[0].authorization, `Bearer ${token}`);
  assert.equal(requests[0].url.pathname, '/service/outapi/product/list');
  assert.equal(requests[0].url.searchParams.get('store_name'), 'Sample');
  assert.equal((await run(['shop', 'products', 'get', '123'], env)).body.data.id, '123');
  assert.equal((await run(['shop', 'products', 'get', '456'], env)).code, 8);
  const count = requests.length;
  for (const args of [['get', '../123'], ['list', '--page', '100001'], ['list', '--limit', '101']]) assert.equal((await run(['shop', 'products', ...args], env)).code, 2);
  assert.equal(requests.length, count);
});

test('Shop orders retain integer filters and exclude customer, invoice and raw item data', async t => {
  const { run, requests } = await fixture(t, (req, res) => res.end(JSON.stringify({ status: 200, data: req.url.pathname.endsWith('/list') ? { list: [order], count: 1 } : order })));
  const env = { CINA_SHOP_ACCESS_TOKEN: token };
  const result = await run(['shop', 'orders', 'list', '--status', '1', '--paid', '1'], env);
  assert.equal(result.code, 0); assert.equal(result.body.data.items[0].paid, true);
  assert.equal(result.body.data.items[0].createdAt, '2026-09-07T00:00:00.000Z');
  assert.equal(result.body.data.items[0].paidAt, null);
  assert.equal(requests[0].url.searchParams.get('status'), '1');
  assert.equal(requests[0].url.searchParams.get('paid'), '1');
  assert.equal((await run(['shop', 'orders', 'get', 'ORDER-10'], env)).code, 0);
  assert.equal((await run(['shop', 'orders', 'get', 'ORDER-11'], env)).code, 8);
  assert.equal((await run(['shop', 'orders', 'list', '--status', 'pending'], env)).code, 2);
});

test('Shop checks HTTP-200 business errors and rejects malformed data without empty-success fallback', async t => {
  let status = 410000;
  const { run, requests } = await fixture(t, (_req, res) => {
    if (status === 501) res.writeHead(501);
    res.end(JSON.stringify({ status, msg: 'private-server-message', data: {} }));
  });
  for (const [value, code] of [[410000, 3], [410001, 3], [400011, 4], [404, 5], [400, 6], [429, 7], [501, 8], [200, 8]]) {
    status = value; assert.equal((await run(['shop', 'orders', 'list'], { CINA_SHOP_ACCESS_TOKEN: token })).code, code);
  }
  assert.equal(requests.length, 8);
});

function shopServer(req, res) {
  if (req.url.pathname.endsWith('/get_token')) {
    if (req.body.appid !== 'test-app' || req.body.appsecret !== secret) return res.end(JSON.stringify({ status: 400, msg: 'private-auth-error' }));
    return res.end(JSON.stringify({ status: 200, data: { token, access_token: token, exp_time: expires(), auth_info: { id: 7, appid: 'test-app', title: 'Test' } } }));
  }
  if (req.url.pathname.endsWith('/refresh_token')) return res.end(JSON.stringify({ status: 200, data: { token: nextToken, access_token: nextToken, exp_time: expires() } }));
  return res.end(JSON.stringify({ status: 200, data: { list: [product], count: 1 } }));
}
const appEnv = { CINA_SHOP_APP_ID: 'test-app', CINA_SHOP_APP_SECRET: secret };

test('Shop login, reads, explicit refresh and logout bind verified account; config never stores secrets', async t => {
  const { run, requests, secrets, directory } = await fixture(t, shopServer);
  await run(['config', 'set', 'shop.accountId', '7']);
  assert.equal((await run(['shop', 'products', 'list'], { CINA_SHOP_ACCESS_TOKEN: token })).code, 6);
  assert.equal(requests.length, 0);
  const login = await run(['login', '--product', 'shop'], appEnv);
  assert.equal(login.code, 0); assert.equal(login.body.data.principal, '7'); assert.equal(secrets.size, 1);
  assert.ok(![...secrets.values()][0].includes(secret));
  assert.equal((await run(['shop', 'products', 'list'])).code, 0);
  assert.equal(requests.at(-1).authorization, `Bearer ${token}`);
  const refresh = await run(['shop', 'session', 'refresh']);
  assert.equal(refresh.code, 0); assert.equal(refresh.body.data.refreshed, true);
  assert.equal(requests.at(-1).method, 'POST'); assert.equal(requests.at(-1).body.access_token, token);
  assert.equal((await run(['shop', 'products', 'list'])).code, 0);
  assert.equal(requests.at(-1).authorization, `Bearer ${nextToken}`);
  const count = requests.length;
  assert.equal((await run(['shop', 'session', 'refresh'], { CINA_SHOP_ACCESS_TOKEN: token })).code, 6);
  const logout = await run(['logout', '--product', 'shop']);
  assert.equal(logout.code, 0); assert.equal(logout.body.data.remoteRevocation, 'not-supported');
  assert.equal(requests.length, count); assert.equal(secrets.size, 0);
  const files = await readdir(directory); assert.deepEqual(files, ['config.json']);
  const config = await readFile(join(directory, 'config.json'), 'utf8');
  assert.ok(!config.includes(secret) && !config.includes(token));
});

test('Shop login supports explicit secret stdin/no-store and rejects ambiguous or wrong-account credentials', async t => {
  const { run, requests, secrets } = await fixture(t, shopServer);
  const unavailable = { store: { get: async () => { throw new Error('private-keyring-unavailable'); } }, readSecret: async () => secret };
  const noStore = await run(['login', '--product', 'shop', '--secret-stdin', '--no-store'], { CINA_SHOP_APP_ID: 'test-app' }, unavailable);
  assert.equal(noStore.code, 0); assert.equal(noStore.body.data.saved, false); assert.equal(secrets.size, 0);
  const count = requests.length;
  for (const [args, env, code] of [
    [['--secret-stdin'], appEnv, 2], [['--token-stdin'], appEnv, 2], [['--credential', 'gateway'], appEnv, 2],
    [[], { ...appEnv, CINA_SHOP_ACCESS_TOKEN: token }, 2], [[], {}, 3],
  ]) assert.equal((await run(['login', '--product', 'shop', ...args], env)).code, code);
  assert.equal(requests.length, count);
  await run(['config', 'set', 'shop.accountId', '8']);
  assert.equal((await run(['login', '--product', 'shop'], appEnv)).code, 6); assert.equal(secrets.size, 0);
});

test('Shop refresh is serialized and uncertain responses are not retried or marked retryable', async t => {
  let mode = 'hold'; let release; let entered;
  const pending = new Promise(resolve => { entered = resolve; });
  const { run, requests, directory } = await fixture(t, async (req, res) => {
    if (!req.url.pathname.endsWith('/refresh_token')) return shopServer(req, res);
    if (mode === 'hold') { entered(); await new Promise(resolve => { release = resolve; }); }
    res.writeHead(503).end('private-server-error');
  });
  assert.equal((await run(['login', '--product', 'shop'], appEnv)).code, 0);
  const first = run(['shop', 'session', 'refresh']); await pending;
  const second = await run(['shop', 'session', 'refresh']); assert.equal(second.code, 6);
  assert.equal((await run(['logout', '--product', 'shop'])).code, 6);
  release();
  const failed = await first;
  assert.equal(failed.code, 7); assert.equal(failed.body.error.retryable, false);
  assert.equal(requests.filter(req => req.url.pathname.endsWith('/refresh_token')).length, 1);
  assert.deepEqual(await readdir(directory), ['config.json']);
  mode = 'fail'; assert.equal((await run(['logout', '--product', 'shop'])).code, 0);
});
