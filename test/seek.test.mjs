import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { newWebSocketRpcSession, RpcTarget } from 'capnweb';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { setImmediate as nextTick } from 'node:timers/promises';
import { runCli } from '../dist/cli.js';
import { CliError } from '../dist/core/errors.js';

const sessionToken = 'user:synthetic-seek-session';
const identity = { type: 'user', id: 'user-1', name: 'Sample', extra: 'private-profile' };
const workspace = { id: 'workspace-1', title: 'Sample', created: new Date('2026-09-01T00:00:00Z'), lastActive: new Date('2026-09-07T00:00:00Z'), totalCost: 0.0000001, extra: 'private-workspace' };
const config = { authVendors: [{ vendorId: 'sample', displayName: 'Sample' }], passwordAuthEnabled: false, extra: 'private-config' };

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'cinacli-seek-'));
  const sockets = new Set(), tcp = new Set(), roots = new Set(), secrets = new Map();
  const state = { calls: [], headers: [], closed: 0, authDisposed: 0, attemptsDisposed: 0, pending: undefined, waiting: undefined, lastSocket: undefined };
  const http = createServer((req, res) => {
    if (req.url.startsWith('/login')) { state.pending?.(sessionToken); res.end('Login completed'); }
    else res.writeHead(404).end();
  });
  http.on('connection', socket => { tcp.add(socket); socket.on('close', () => tcp.delete(socket)); });
  const wss = new WebSocketServer({ noServer: true });
  class Authenticated extends RpcTarget {
    whoami() { state.calls.push('whoami'); return options.identity ?? identity; }
    listGadgets() { state.calls.push('listGadgets'); if (options.disconnect) state.lastSocket.terminate(); return options.workspaces ?? [workspace]; }
    [Symbol.dispose]() { state.authDisposed++; }
  }
  class Attempt extends RpcTarget {
    wait() { state.calls.push('wait'); state.waiting?.(); return new Promise(resolve => { state.pending = resolve; if (!options.hold) resolve(sessionToken); }); }
    [Symbol.dispose]() { state.attemptsDisposed++; state.pending?.('cancelled'); }
  }
  class Public extends RpcTarget {
    getServerConfig() { state.calls.push('getServerConfig'); return options.config ?? config; }
    authenticate(value) {
      state.calls.push('authenticate');
      if (value !== sessionToken) throw new Error('invalid session token');
      return new Authenticated();
    }
    startGatekeeperLogin(vendor) {
      state.calls.push('startGatekeeperLogin'); assert.equal(vendor, 'sample');
      return { url: options.loginUrl ?? `http://127.0.0.1:${http.address().port}/login`, attempt: new Attempt() };
    }
  }
  http.on('upgrade', (req, socket, head) => {
    state.headers.push(req.headers);
    if (options.deny) { socket.end(`HTTP/1.1 ${options.deny} Rejected\r\nLocation: https://access.example/login?key=private-value\r\nContent-Length: 0\r\n\r\n`); return; }
    if (options.stallHandshake) return;
    wss.handleUpgrade(req, socket, head, ws => {
      sockets.add(ws); state.lastSocket = ws;
      const root = newWebSocketRpcSession(ws, new Public()); roots.add(root);
      ws.on('close', () => { state.closed++; sockets.delete(ws); roots.delete(root); root[Symbol.dispose](); });
    });
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const endpoint = `ws://127.0.0.1:${http.address().port}/api`;
  t.after(async () => {
    for (const root of roots) root[Symbol.dispose]();
    for (const socket of sockets) socket.terminate();
    for (const socket of tcp) socket.destroy();
    await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => http.close(resolve));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('cinacli-seek-'));
    await rm(directory, { recursive: true, force: true });
  });
  const store = { get: async key => secrets.get(key), set: async (key, value) => { secrets.set(key, value); }, remove: async key => secrets.delete(key) };
  async function run(args, env = {}, overrides = {}) {
    const { interactive = false, ...injection } = overrides;
    let stdout = '', stderr = '';
    const code = await runCli(interactive ? args : [...args, '--json'], { env: { CINA_CONFIG_DIR: directory, ...env }, store,
      io: { out: text => { stdout += text; }, err: text => { stderr += text; }, isTTY: interactive }, ...injection });
    for (const secret of [sessionToken, 'private-']) assert.ok(!stdout.includes(secret) && !stderr.includes(secret));
    const body = interactive ? code === 0 ? { data: JSON.parse(stdout) } : { error: { code: stderr.split(':')[0] } } : JSON.parse(stdout);
    return { code, body };
  }
  await run(['context', 'create', 'staging']); await run(['context', 'use', 'staging']); await run(['config', 'set', 'seek.endpoint', endpoint]);
  async function drained() { for (let i = 0; i < 15 && sockets.size; i++) await nextTick(); assert.equal(sockets.size, 0); }
  return { run, state, secrets, directory, drained, endpoint };
}

test('Seek status and authenticated reads use real Capn Web; normalize Dates, metadata and no pagination', async t => {
  const { run, state, drained } = await fixture(t);
  const status = await run(['seek', 'status']); assert.equal(status.code, 0); assert.equal(status.body.data.serverVersion, null);
  const env = { CINA_SEEK_SESSION_TOKEN: sessionToken };
  assert.equal((await run(['seek', 'whoami'], env)).body.data.id, 'user-1');
  const result = await run(['seek', 'workspaces', 'list'], env); assert.equal(result.code, 0);
  assert.equal(result.body.data.items[0].createdAt, '2026-09-01T00:00:00.000Z');
  assert.equal(result.body.data.items[0].totalCost, '0.0000001');
  assert.equal(result.body.data.items[0].owner, null); assert.equal(result.body.data.items[0].role, 'build');
  assert.deepEqual(result.body.meta.pagination, { mode: 'none' });
  assert.ok(state.headers.every(header => !header.authorization && !header.origin && !header.cookie));
  assert.deepEqual(state.calls, ['getServerConfig', 'authenticate', 'whoami', 'authenticate', 'listGadgets']);
  await drained(); assert.equal(state.authDisposed, 2); assert.equal(state.closed, 3);
  assert.equal((await run(['seek', 'workspaces', 'list', '--page', '2'], env)).code, 2);
});

test('Seek validates imported sessions before saving and logout is local', async t => {
  const { run, state, secrets, directory, drained } = await fixture(t);
  assert.equal((await run(['login', '--product', 'seek'], { CINA_SEEK_SESSION_TOKEN: sessionToken })).code, 0);
  assert.equal(secrets.size, 1); const saved = [...secrets.values()];
  assert.equal((await run(['login', '--product', 'seek'], { CINA_SEEK_SESSION_TOKEN: 'bad-session' })).code, 3);
  assert.deepEqual([...secrets.values()], saved);
  assert.equal((await run(['seek', 'whoami'])).code, 0);
  const count = state.calls.length;
  assert.equal((await run(['logout', '--product', 'seek'])).body.data.remoteRevocation, 'not-supported');
  assert.equal(state.calls.length, count); assert.equal(secrets.size, 0);
  assert.equal((await run(['seek', 'whoami'])).code, 3);
  assert.ok(!(await readFile(join(directory, 'config.json'), 'utf8')).includes(sessionToken));
  assert.deepEqual(await readdir(directory), ['config.json']); await drained();
});

test('Seek browser login uses allowlisted vendor and pending capability, verifies user and disposes attempt', async t => {
  const { run, state, secrets, drained } = await fixture(t);
  const opened = [];
  const result = await run(['login', '--product', 'seek', '--vendor', 'sample'], {}, { interactive: true, openBrowser: async url => { opened.push(url); assert.equal((await fetch(url)).status, 200); } });
  assert.equal(result.code, 0); assert.equal(result.body.data.source, 'browser'); assert.equal(result.body.data.principal, 'user-1');
  assert.equal(opened.length, 1); assert.equal(secrets.size, 1);
  assert.deepEqual(state.calls, ['getServerConfig', 'startGatekeeperLogin', 'wait', 'authenticate', 'whoami']);
  await drained(); assert.equal(state.attemptsDisposed, 1); assert.equal(state.authDisposed, 1);
});

test('Seek unattended login never opens a browser, and unsupported vendors cannot start login', async t => {
  const { run, state } = await fixture(t);
  let opened = 0; const openBrowser = async () => { opened++; };
  assert.equal((await run(['login', '--product', 'seek', '--vendor', 'sample'], {}, { openBrowser })).code, 3);
  assert.equal(state.calls.length, 0);
  assert.equal((await run(['login', '--product', 'seek', '--vendor', 'unavailable'], {}, { interactive: true, openBrowser })).code, 8);
  assert.equal(opened, 0); assert.deepEqual(state.calls, ['getServerConfig']);
  assert.equal((await run(['login', '--product', 'seek', '--vendor', 'sample'], { CINA_SEEK_SESSION_TOKEN: sessionToken })).code, 2);
  const noStore = await run(['login', '--product', 'seek', '--token-stdin', '--no-store'], {}, { readSecret: async () => sessionToken, store: { get: async () => { throw new Error('private-unavailable'); } } });
  assert.equal(noStore.code, 0); assert.equal(noStore.body.data.saved, false);
});

test('Seek unsafe browser URLs and malformed RPC payloads fail without leaking remote data', async t => {
  const bad = await fixture(t, { loginUrl: 'file:///private-file' });
  assert.equal((await bad.run(['login', '--product', 'seek', '--vendor', 'sample'], {}, { interactive: true, openBrowser: async () => assert.fail('must not open') })).code, 8);
  await bad.drained(); assert.equal(bad.state.attemptsDisposed, 1);
  const malformed = await fixture(t, { workspaces: [{ ...workspace, created: 'not-a-Date' }] });
  assert.equal((await malformed.run(['seek', 'workspaces', 'list'], { CINA_SEEK_SESSION_TOKEN: sessionToken })).code, 8);
  await malformed.drained(); assert.equal(malformed.state.authDisposed, 1);
});

test('Seek cancellation releases pending login, socket and credential lock without saving', async t => {
  const { run, state, secrets, directory, drained } = await fixture(t, { hold: true });
  const controller = new AbortController(); const waiting = new Promise(resolve => { state.waiting = resolve; });
  const pending = run(['login', '--product', 'seek', '--vendor', 'sample'], {}, { interactive: true, signal: controller.signal, openBrowser: async () => {} });
  await waiting; controller.abort(new CliError('CANCELLED'));
  assert.equal((await pending).code, 130); assert.equal(secrets.size, 0);
  await drained(); assert.equal(state.attemptsDisposed, 1); assert.deepEqual(await readdir(directory), ['config.json']);
});

test('Seek rejects gated WebSocket upgrades without fabricating Origin or retrying', async t => {
  for (const deny of [302, 403]) {
    const { run, state } = await fixture(t, { deny });
    assert.equal((await run(['seek', 'status'])).code, 8);
    assert.equal(state.headers.length, 1); assert.ok(!state.headers[0].origin && !state.headers[0].authorization);
  }
});

test('Seek connection loss and stalled handshake terminate with stable errors and no reconnect', async t => {
  const disconnected = await fixture(t, { disconnect: true });
  assert.equal((await disconnected.run(['seek', 'workspaces', 'list'], { CINA_SEEK_SESSION_TOKEN: sessionToken })).code, 7);
  assert.equal(disconnected.state.headers.length, 1); await disconnected.drained();
  const stalled = await fixture(t, { stallHandshake: true });
  assert.equal((await stalled.run(['seek', 'status', '--timeout', '0.05'])).code, 9);
  assert.equal(stalled.state.headers.length, 1);
});
