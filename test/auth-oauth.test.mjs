import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
// The package smoke runner repeats these protocol checks against the installed tarball.
const { runCli } = await import(process.env.CINACLI_TEST_INSTALLED_MODULE ?? '../dist/cli.js');

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
const ecKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ecJwk = { ...ecKeys.publicKey.export({ format: 'jwk' }), kid: 'fixture-ec-key', alg: 'ES256', use: 'sig' };
const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
function jwt(claims, broken = false, ec = false) {
  const data = `${encode({ alg: ec ? 'ES256' : 'RS256', kid: ec ? ecJwk.kid : jwk.kid })}.${encode(claims)}`;
  const signature = sign('SHA256', Buffer.from(data), ec ? { key: ecKeys.privateKey, dsaEncoding: 'ieee-p1363' } : keys.privateKey);
  if (broken) signature[0] ^= 1;
  return `${data}.${signature.toString('base64url')}`;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cinacli-auth-oauth-'));
  const state = { mode: '', auth: null, requests: [], revoked: [], refreshes: 0, verifiers: [], writes: 0 };
  const secrets = new Map();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = new URLSearchParams(Buffer.concat(chunks).toString());
    const path = new URL(req.url, endpoint).pathname;
    state.requests.push(path);
    res.setHeader('Content-Type', 'application/json');
    if (path === '/.well-known/openid-configuration') return res.end(JSON.stringify({
      issuer: endpoint, authorization_endpoint: `${endpoint}/authorize`, token_endpoint: `${endpoint}/token`, userinfo_endpoint: `${endpoint}/userinfo`, jwks_uri: `${endpoint}/jwks`, revocation_endpoint: `${endpoint}/revoke`,
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: [state.mode === 'es256' ? 'ES256' : 'RS256'], grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: state.mode === 'no-revoke' ? ['client_secret_basic'] : ['none'],
      code_challenge_methods_supported: ['S256'], scopes_supported: ['openid', 'profile', 'email', 'offline_access'], authorization_response_iss_parameter_supported: true,
    }));
    if (path === '/jwks') return res.end(JSON.stringify({ keys: [jwk, ecJwk] }));
    if (path === '/token') {
      assert.equal(req.headers.authorization, undefined);
      assert.equal(body.get('client_id'), 'cli-test');
      assert.equal(body.has('client_secret'), false);
      const refresh = body.get('grant_type') === 'refresh_token';
      if (refresh) {
        state.refreshes++;
        assert.equal(body.get('refresh_token'), `synthetic-refresh-${state.refreshes - 1}`);
        if (state.mode === 'stall-refresh') return;
        if (state.mode === 'revoked') return res.writeHead(400).end(JSON.stringify({ error: 'invalid_grant', error_description: 'private-secret-detail' }));
      } else {
        assert.equal(body.get('grant_type'), 'authorization_code');
        assert.equal(body.get('code'), 'synthetic-code');
        assert.equal(body.get('redirect_uri'), state.auth.searchParams.get('redirect_uri'));
        const verifier = body.get('code_verifier');
        state.verifiers.push(verifier);
        assert.equal(createHash('sha256').update(verifier).digest('base64url'), state.auth.searchParams.get('code_challenge'));
      }
      if (state.mode === 'redirect') return res.writeHead(302, { Location: `${endpoint}/trap` }).end();
      if (state.mode === 'oversize') return res.end('x'.repeat(262145));
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: endpoint, sub: 'user-1', aud: 'cli-test', iat: now, exp: now + 3600, nonce: state.auth.searchParams.get('nonce'), auth_time: state.authTime ??= now };
      if (state.mode === 'nonce') claims.nonce = 'wrong';
      if (state.mode === 'issuer') claims.iss = `${endpoint}/wrong`;
      if (state.mode === 'audience') claims.aud = 'another-client';
      if (state.mode === 'azp') { claims.aud = ['cli-test', 'another']; claims.azp = 'another'; }
      if (state.mode === 'single-azp') claims.azp = 'another';
      if (state.mode === 'future') claims.iat = now + 3600;
      if (state.mode === 'expired') claims.exp = now - 60;
      if (state.mode === 'subject') claims.sub = 'another-user';
      return res.end(JSON.stringify({ access_token: `synthetic-access-${state.refreshes}`, refresh_token: `synthetic-refresh-${state.refreshes}`, token_type: 'Bearer', expires_in: 3600,
        scope: 'openid profile email offline_access', ...(state.mode === 'no-id-token' ? {} : { id_token: jwt(claims, state.mode === 'signature', state.mode === 'es256') }) }));
    }
    if (path === '/userinfo') {
      assert.equal(req.headers.authorization, `Bearer synthetic-access-${state.refreshes}`);
      if (state.mode === 'userinfo-revoked') return res.writeHead(401).end(JSON.stringify({ error: 'invalid_token' }));
      return res.end(JSON.stringify({ sub: state.mode === 'userinfo-subject' ? 'another-user' : 'user-1', name: 'Example User', email: 'user@example.test', email_verified: true, internal: 'private-field' }));
    }
    if (path === '/revoke') {
      assert.equal(body.get('client_id'), 'cli-test');
      assert.equal(body.has('client_secret'), false);
      state.revoked.push(body.get('token_type_hint'));
      if (state.mode === 'revoke-fail') return res.writeHead(400).end(JSON.stringify({ error: 'unsupported_token_type' }));
      return res.end('{}');
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('cinacli-auth-oauth-'));
    await rm(directory, { recursive: true, force: true });
  });
  const store = { get: async key => secrets.get(key), set: async (key, value) => { state.writes++; secrets.set(key, value); }, remove: async key => secrets.delete(key) };
  async function openBrowser(value) {
    const url = new URL(value); state.auth = url;
    assert.equal(url.origin, endpoint); assert.equal(url.pathname, '/authorize');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('response_mode'), 'query');
    const callback = new URL(url.searchParams.get('redirect_uri'));
    assert.equal(callback.hostname, '127.0.0.1'); assert.equal(callback.pathname, '/callback');
    callback.searchParams.set('state', state.mode === 'state' ? 'wrong' : url.searchParams.get('state'));
    callback.searchParams.set('iss', state.mode === 'callback-issuer' ? `${endpoint}/wrong` : endpoint);
    if (state.mode === 'denied') callback.searchParams.set('error', 'access_denied');
    else callback.searchParams.set('code', 'synthetic-code');
    if (state.mode === 'duplicate-state') callback.searchParams.append('state', 'other');
    const response = await fetch(callback);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!(await response.text()).includes('synthetic-code'));
  }
  async function run(args, options = {}) {
    const { interactive = false, ...overrides } = options;
    let stdout = '', stderr = '';
    const code = await runCli(interactive ? args : [...args, '--json'], { env: { CINA_CONFIG_DIR: directory }, store, openBrowser,
      io: { out: value => { stdout += value; }, err: value => { stderr += value; }, isTTY: interactive }, ...overrides });
    for (const value of ['synthetic-', 'private-', ...state.verifiers]) assert.ok(!stdout.includes(value) && !stderr.includes(value), 'no token, verifier or upstream secrets in output');
    const body = interactive ? code === 0 ? { data: JSON.parse(stdout) } : { error: { message: stderr } } : JSON.parse(stdout);
    return { code, body };
  }
  await run(['context', 'create', 'test']); await run(['context', 'use', 'test']);
  await run(['config', 'set', 'auth.issuer', endpoint]); await run(['config', 'set', 'auth.clientId', 'cli-test']);
  return { run, state, secrets, directory, endpoint, openBrowser };
}

test('Auth PKCE exchanges verified code, validates signature and userinfo, stores only keyring session, then refreshes and revokes', async t => {
  const { run, state, secrets, directory } = await fixture(t);
  const result = await run(['login'], { interactive: true });
  assert.equal(result.code, 0, JSON.stringify(result)); assert.equal(result.body.data.principal, 'user-1');
  assert.equal(state.writes, 1); assert.equal(secrets.size, 1);
  assert.ok(state.requests.includes('/jwks')); assert.ok(state.requests.includes('/userinfo'));
  const identity = await run(['whoami']);
  assert.equal(identity.code, 0); assert.equal(identity.body.data.subject, 'user-1'); assert.equal(identity.body.data.emailVerified, true);
  const refreshed = await run(['auth', 'session', 'refresh']);
  assert.equal(refreshed.code, 0, JSON.stringify(refreshed)); assert.equal(state.refreshes, 1); assert.equal(state.writes, 2);
  assert.equal((await run(['auth', 'whoami'])).code, 0);
  assert.equal(JSON.parse([...secrets.values()][0]).refreshToken, 'synthetic-refresh-1');
  assert.equal((await run(['logout', '--revoke'])).body.data.remoteRevocation, 'requested');
  assert.deepEqual(state.revoked, ['refresh_token', 'access_token']); assert.equal(secrets.size, 0);
  assert.equal((await run(['whoami'])).code, 3);
  for (const file of await readdir(directory)) assert.ok(!(await readFile(join(directory, file), 'utf8')).includes('synthetic-'));
});

test('Auth rejects state, issuer and duplicate callback parameters or denied consent before token exchange', async t => {
  const { run, state, secrets } = await fixture(t);
  for (const mode of ['state', 'callback-issuer', 'duplicate-state', 'denied']) {
    state.mode = mode;
    const result = await run(['login'], { interactive: true });
    assert.equal(result.code, mode === 'denied' ? 4 : 3, mode);
    assert.equal(secrets.size, 0); assert.ok(!state.requests.includes('/token'));
  }
});

test('Auth rejects nonce, issuer, audience, azp, expiry, signature and userinfo substitution without overwriting a saved session', async t => {
  const { run, state, secrets } = await fixture(t);
  assert.equal((await run(['login'], { interactive: true })).code, 0);
  const saved = [...secrets.values()][0];
  for (const mode of ['nonce', 'issuer', 'audience', 'azp', 'single-azp', 'future', 'expired', 'signature', 'no-id-token', 'userinfo-subject']) {
    state.mode = mode;
    assert.equal((await run(['login'], { interactive: true })).code, 3, mode);
    assert.equal([...secrets.values()][0], saved);
  }
});

test('Auth browser login rejects noninteractive and incompatible flags, supports no-store, never follows token redirects', async t => {
  const { run, state, secrets } = await fixture(t);
  assert.equal((await run(['login'])).code, 3); assert.equal(state.requests.length, 0);
  assert.equal((await run(['login', '--no-input'], { interactive: true })).code, 3);
  for (const args of [['--token-stdin'], ['--secret-stdin'], ['--credential', 'gateway'], ['--vendor', 'test']]) assert.equal((await run(['login', ...args], { interactive: true })).code, 2);
  assert.equal((await run(['login', '--no-store'], { interactive: true })).code, 0); assert.equal(secrets.size, 0);
  for (const mode of ['redirect', 'oversize']) {
    state.mode = mode; assert.equal((await run(['login'], { interactive: true })).code, 8); assert.equal(secrets.size, 0);
  }
  assert.ok(!state.requests.includes('/trap'));
});

test('Auth cancellation closes callback port and removes lock; unrelated callback paths cannot complete login', async t => {
  const { run, directory, secrets } = await fixture(t);
  const controller = new AbortController(); let callback;
  const result = await run(['login'], { interactive: true, signal: controller.signal, openBrowser: async value => {
    callback = new URL(new URL(value).searchParams.get('redirect_uri'));
    assert.equal((await fetch(new URL('/favicon.ico', callback))).status, 400);
    assert.equal((await fetch(callback, { method: 'POST' })).status, 400);
    controller.abort();
  } });
  assert.equal(result.code, 130); assert.equal(secrets.size, 0);
  assert.ok(!(await readdir(directory)).some(name => name.endsWith('.lock')));
  await assert.rejects(fetch(callback));
});

test('Auth expired access token requires explicit refresh; missing refresh and revoked sessions return errors', async t => {
  const { run, state, secrets } = await fixture(t);
  assert.equal((await run(['login'], { interactive: true })).code, 0);
  const key = [...secrets.keys()][0], saved = JSON.parse(secrets.get(key));
  saved.expiresAt = '2000-01-01T00:00:00.000Z'; secrets.set(key, JSON.stringify(saved));
  assert.equal((await run(['whoami'])).body.error.code, 'TOKEN_EXPIRED'); assert.equal(state.refreshes, 0);
  saved.refreshToken = null; secrets.set(key, JSON.stringify(saved));
  assert.equal((await run(['auth', 'session', 'refresh'])).code, 3);
  saved.refreshToken = 'synthetic-refresh-0'; secrets.set(key, JSON.stringify(saved)); state.mode = 'revoked';
  const result = await run(['auth', 'session', 'refresh']);
  assert.equal(result.code, 3); assert.equal(result.body.error.retryable, false); assert.equal(state.refreshes, 1);
});

test('Auth refresh verifies unchanged subject and supports omitted ID token; remote revoke failure preserves local cleanup option', async t => {
  const { run, state, secrets } = await fixture(t);
  assert.equal((await run(['login'], { interactive: true })).code, 0);
  state.mode = 'no-id-token'; assert.equal((await run(['auth', 'session', 'refresh'])).code, 0);
  const saved = [...secrets.values()][0];
  state.mode = 'subject'; assert.equal((await run(['auth', 'session', 'refresh'])).code, 3); assert.equal([...secrets.values()][0], saved);
  state.mode = 'no-revoke'; assert.equal((await run(['logout', '--revoke'])).code, 8); assert.equal(secrets.size, 1);
  assert.equal(state.revoked.length, 0);
  state.mode = 'revoke-fail'; assert.equal((await run(['logout', '--revoke'])).code, 8); assert.equal(secrets.size, 1);
  const before = state.requests.length;
  assert.equal((await run(['logout'])).code, 0); assert.equal(secrets.size, 0); assert.equal(state.requests.length, before);
});

test('Auth concurrent refreshes are locked and uncertain rotation is never replayed', async t => {
  const { run, state, directory } = await fixture(t);
  assert.equal((await run(['login'], { interactive: true })).code, 0);
  state.mode = 'stall-refresh';
  const pending = run(['auth', 'session', 'refresh', '--timeout', '1']);
  const start = Date.now();
  while (state.refreshes === 0 && Date.now() - start < 800) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.refreshes, 1);
  const concurrent = await run(['auth', 'session', 'refresh']); assert.equal(concurrent.code, 6);
  const timedOut = await pending;
  assert.equal(timedOut.code, 9); assert.equal(timedOut.body.error.retryable, false); assert.equal(state.refreshes, 1);
  assert.ok(!(await readdir(directory)).some(name => name.endsWith('.lock')));
});

test('Auth config changes during browser login cannot save into an obsolete credential binding', async t => {
  const { run, secrets, openBrowser } = await fixture(t);
  const result = await run(['login'], { interactive: true, openBrowser: async value => {
    await run(['config', 'set', 'auth.clientId', 'changed-client']);
    await openBrowser(value);
  } });
  assert.equal(result.code, 6); assert.equal(secrets.size, 0);
});

test('Auth supports ES256 as advertised by the public CinaAuth deployment', async t => {
  const { run, state } = await fixture(t); state.mode = 'es256';
  assert.equal((await run(['login'], { interactive: true })).code, 0);
  assert.equal((await run(['auth', 'session', 'refresh'])).code, 0);
});
