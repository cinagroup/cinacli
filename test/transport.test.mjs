import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestJson, deadline, probeEndpoint } from '../dist/core/transport.js';
import { CliError } from '../dist/core/errors.js';

async function server(t, handler) {
  const instance = createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(async () => { instance.closeAllConnections(); await new Promise(resolve => instance.close(resolve)); });
  return `http://127.0.0.1:${instance.address().port}`;
}

function timer(t, milliseconds = 2000, parent) {
  const value = deadline(milliseconds, parent);
  t.after(value.dispose);
  return value.signal;
}

test('explicit idempotent reads retry transient status but writes do not', async t => {
  let reads = 0, writes = 0;
  const url = await server(t, (req, res) => {
    if (req.method === 'POST') { writes++; res.writeHead(503).end(); return; }
    reads++;
    if (reads < 3) res.writeHead(503, { 'Retry-After': '0' }).end();
    else res.end('{"items":[]}');
  });
  assert.deepEqual(await requestJson(url, { signal: timer(t), retryRead: true }), { items: [] });
  assert.equal(reads, 3);
  await assert.rejects(requestJson(url, { signal: timer(t), method: 'POST', body: '{}' }), { code: 'UPSTREAM_UNAVAILABLE' });
  assert.equal(writes, 1);
});

test('credentials never follow a redirect and raw error bodies are not exposed', async t => {
  let targetRequests = 0;
  const target = await server(t, (_req, res) => { targetRequests++; res.end('{}'); });
  const url = await server(t, (_req, res) => res.writeHead(302, { Location: target }).end('private-secret'));
  await assert.rejects(requestJson(url, { signal: timer(t), headers: { Authorization: 'Bearer synthetic-secret' } }), error => {
    assert.equal(error.code, 'UPSTREAM_CONTRACT_MISMATCH');
    assert.ok(!error.message.includes('private-secret'));
    return true;
  });
  assert.equal(targetRequests, 0);
});

test('deadline covers response body and respects parent cancellation', async t => {
  const url = await server(t, (_req, res) => { res.writeHead(200); res.write('{'); });
  await assert.rejects(requestJson(url, { signal: timer(t, 100) }), { code: 'TIMEOUT' });
  const controller = new AbortController();
  controller.abort(new CliError('CANCELLED'));
  await assert.rejects(requestJson(url, { signal: timer(t, 100, controller.signal) }), { code: 'CANCELLED' });
});

test('invalid/oversized JSON and long Retry-After fail with a bounded result', async t => {
  let calls = 0;
  const url = await server(t, (req, res) => {
    calls++;
    if (req.url === '/rate') res.writeHead(429, { 'Retry-After': '600' }).end('private-secret');
    else res.end('not-json'.repeat(100));
  });
  await assert.rejects(requestJson(url, { signal: timer(t), maxBytes: 20 }), { code: 'UPSTREAM_CONTRACT_MISMATCH' });
  await assert.rejects(requestJson(url, { signal: timer(t) }), { code: 'UPSTREAM_CONTRACT_MISMATCH' });
  const before = calls;
  await assert.rejects(requestJson(`${url}/rate`, { signal: timer(t), retryRead: true }), { code: 'RATE_LIMITED' });
  assert.equal(calls, before + 1);
});

test('doctor TCP probe sends no HTTP request', async t => {
  let requests = 0;
  const url = await server(t, (_req, res) => { requests++; res.end(); });
  await probeEndpoint(url, timer(t));
  assert.equal(requests, 0);
});
