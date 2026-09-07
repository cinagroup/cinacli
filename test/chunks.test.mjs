import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkedSecretStore } from '../dist/core/credentials/chunks.js';

function fixture() {
  const entries = new Map();
  const raw = { get: async key => entries.get(key), set: async (key, value) => { assert.ok(value.length <= 1000); entries.set(key, value); }, remove: async key => entries.delete(key) };
  return { entries, raw, store: chunkedSecretStore(raw) };
}

test('Native-sized chunks round-trip large Unicode credentials and remove obsolete generations', async () => {
  const { entries, store } = fixture();
  const long = '测试🔑'.repeat(2000);
  await store.set('key', 'legacy'); assert.equal(await store.get('key'), 'legacy');
  await store.set('key', long); assert.equal(await store.get('key'), long); assert.ok(entries.size > 2);
  const previous = [...entries.keys()].filter(key => key !== 'key');
  await store.set('key', long + '!'); assert.equal(await store.get('key'), long + '!');
  assert.ok(previous.every(key => !entries.has(key)));
  await store.set('key', 'small'); assert.equal(entries.size, 1); assert.equal(await store.get('key'), 'small');
  await store.set('key', long); assert.equal(await store.remove('key'), true); assert.equal(entries.size, 0);
});

test('Failed chunk staging preserves the old session; uncertain index commit never deletes referenced chunks', async () => {
  const { entries, raw, store } = fixture();
  await store.set('key', 'old');
  const original = raw.set; let count = 0;
  raw.set = async (key, value) => { if (++count === 2) throw Error('write failed'); return original(key, value); };
  await assert.rejects(store.set('key', 'x'.repeat(4000))); assert.equal(await store.get('key'), 'old'); assert.equal(entries.size, 1);
  raw.set = async (key, value) => { await original(key, value); if (key === 'key') throw Error('uncertain native completion'); };
  await assert.rejects(store.set('key', 'x'.repeat(4000))); assert.equal(await store.get('key'), 'x'.repeat(4000));
});

test('Missing/tampered chunks and invalid manifests fail closed; oversize values leave existing credentials intact', async () => {
  const { entries, store } = fixture();
  await store.set('key', 'x'.repeat(4000));
  await assert.rejects(store.set('key', 'y'.repeat(65537)), { code: 'CAPABILITY_UNAVAILABLE' });
  assert.equal(await store.get('key'), 'x'.repeat(4000));
  const part = [...entries.keys()].find(key => key !== 'key'); entries.set(part, 'eQ==');
  await assert.rejects(store.get('key'), { code: 'AUTHENTICATION_FAILED' });
  entries.delete(part); await assert.rejects(store.get('key'), { code: 'AUTHENTICATION_FAILED' });
  entries.set('key', 'cinacli-chunks-v1:{"parts":999999}');
  await assert.rejects(store.get('key'), { code: 'AUTHENTICATION_FAILED' });
  await store.set('key', 'repaired'); assert.equal(await store.get('key'), 'repaired');
});
