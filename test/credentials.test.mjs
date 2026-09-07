import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialBinding, credentialKey, saveCredential, resolveCredential } from '../dist/core/credentials/store.js';
import { createContext, setConfigValue } from '../dist/core/context/store.js';

function fixture() {
  const config = { version: 1, current: null, contexts: [] };
  const staging = createContext(config, 'staging');
  const production = createContext(config, 'production');
  for (const context of [staging, production]) setConfigValue(context, 'token.endpoint', 'https://api.example.test');
  const values = new Map();
  const store = { get: async key => values.get(key), set: async (key, value) => { values.set(key, value); }, remove: async key => values.delete(key) };
  const binding = credentialBinding(staging, 'token-gateway');
  const credential = { version: 1, binding, secret: 'synthetic-secret', principal: null, scopes: [], expiresAt: null };
  return { staging, production, values, store, binding, credential };
}

test('saved secrets cannot cross contexts, credential schemes or endpoint revisions', async () => {
  const { staging, production, store, binding, credential } = fixture();
  await saveCredential(store, credential);
  assert.equal((await resolveCredential(store, binding, {})).credential.secret, 'synthetic-secret');
  for (const other of [credentialBinding(production, 'token-gateway'), credentialBinding(staging, 'token-management')]) {
    await assert.rejects(resolveCredential(store, other, {}), { code: 'CREDENTIAL_REQUIRED' });
  }
  setConfigValue(staging, 'token.endpoint', 'https://other.example.test');
  await assert.rejects(resolveCredential(store, credentialBinding(staging, 'token-gateway'), {}), { code: 'CREDENTIAL_REQUIRED' });
  setConfigValue(staging, 'token.endpoint', 'https://api.example.test');
  await assert.rejects(resolveCredential(store, credentialBinding(staging, 'token-gateway'), {}), { code: 'CREDENTIAL_REQUIRED' });
});

test('unchanged config retains binding while resource changes invalidate it', () => {
  const { staging, binding } = fixture();
  setConfigValue(staging, 'token.endpoint', 'https://api.example.test/');
  assert.equal(credentialKey(credentialBinding(staging, 'token-gateway')), credentialKey(binding));
  setConfigValue(staging, 'token.workspaceId', 'workspace-2');
  assert.notEqual(credentialKey(credentialBinding(staging, 'token-gateway')), credentialKey(binding));
});

test('environment override is ephemeral, scheme-specific and fails closed when empty', async () => {
  const { store, binding, credential, values } = fixture();
  await saveCredential(store, credential);
  const envResult = await resolveCredential(store, binding, { CINA_TOKEN_GATEWAY_KEY: 'synthetic-env-key' });
  assert.equal(envResult.source, 'environment');
  assert.equal(envResult.credential.secret, 'synthetic-env-key');
  assert.ok(![...values.values()].join('').includes('synthetic-env-key'));
  assert.equal((await resolveCredential(store, binding, { CINA_TOKEN_MANAGEMENT_KEY: 'other-key' })).source, 'keyring');
  await assert.rejects(resolveCredential(store, binding, { CINA_TOKEN_GATEWAY_KEY: '' }), { code: 'CREDENTIAL_REQUIRED' });
  await assert.rejects(resolveCredential(store, binding, { CINA_TOKEN_GATEWAY_KEY: 'x\nInjected' }), { code: 'CREDENTIAL_REQUIRED' });
});

test('environment auth works without loading a system keyring', async () => {
  const { binding } = fixture();
  const store = { get: async () => { throw new Error('must not load'); } };
  assert.equal((await resolveCredential(store, binding, { CINA_TOKEN_GATEWAY_KEY: 'key' })).source, 'environment');
});

test('expired, malformed and mismatched stored records fail authentication', async () => {
  const { binding, store, credential, values } = fixture();
  await saveCredential(store, { ...credential, expiresAt: '2000-01-01T00:00:00Z' });
  await assert.rejects(resolveCredential(store, binding, {}), { code: 'TOKEN_EXPIRED' });
  values.set(credentialKey(binding), 'invalid private-secret');
  await assert.rejects(resolveCredential(store, binding, {}), { code: 'AUTHENTICATION_FAILED' });
  values.set(credentialKey(binding), JSON.stringify({ ...credential, binding: { ...binding, endpoint: 'https://wrong.example.test' } }));
  await assert.rejects(resolveCredential(store, binding, {}), { code: 'AUTHENTICATION_FAILED' });
});
