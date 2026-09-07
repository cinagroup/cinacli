import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { systemSecretStore, probeSecretStore, credentialBinding, credentialKey, saveCredential, resolveCredential } from '../dist/core/credentials/store.js';
import { createContext, setConfigValue } from '../dist/core/context/store.js';

// This namespace and secret are unique to this invocation; no user credentials are read.
const service = `cinacli-smoke/${randomUUID()}`;
const store = systemSecretStore(service);
const context = createContext({ version: 1, current: null, contexts: [] }, 'native-smoke');
setConfigValue(context, 'token.endpoint', 'https://test.invalid');
const binding = credentialBinding(context, 'token-gateway');
const secret = randomUUID();
assert.equal(await probeSecretStore(store), true, 'OS keyring is unavailable or locked');
try {
  await saveCredential(store, { version: 1, binding, secret, principal: null, scopes: [], expiresAt: null });
  const loaded = await resolveCredential(store, binding, {});
  assert.equal(loaded.credential.secret, secret);
  assert.equal(loaded.source, 'keyring');
  // OAuth access + refresh tokens can exceed a native Windows credential blob.
  const oauthSized = JSON.stringify({ accessToken: 'a'.repeat(2400), refreshToken: 'b'.repeat(1800), subject: '测试用户🔑' });
  await store.set(credentialKey(binding), oauthSized);
  assert.equal(await store.get(credentialKey(binding)), oauthSized);
  await saveCredential(store, { version: 1, binding, secret, principal: null, scopes: [], expiresAt: null });
  assert.equal((await resolveCredential(store, binding, {})).credential.secret, secret);
} finally {
  await store.remove(credentialKey(binding));
}
assert.equal(await store.get(credentialKey(binding)), undefined);
await assert.rejects(resolveCredential(store, binding, {}), { code: 'CREDENTIAL_REQUIRED' });
console.log(JSON.stringify({ ok: true, platform: process.platform, storage: 'system-keyring', roundTrip: true, deleted: true }));
