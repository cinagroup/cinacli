import * as oauth from "oauth4webapi";
import * as z from "zod";
import { loadProduct, parseUpstream } from "../../core/product.js";
import { bindingSchema, credentialBinding, credentialKey } from "../../core/credentials/store.js";
import { assertCurrentBinding, withCredentialLock } from "../../core/credentials/lock.js";
import { CliError, safeError } from "../../core/errors.js";
import { readDiscovery } from "./handler.js";
import { listenForCallback } from "./callback.js";
import { requestOptions, safely } from "./oauth.js";
import type { Runtime } from "../../core/command.js";
import type { CredentialBinding } from "../../core/credentials/store.js";

type Input = { context?: string | undefined; credential?: string | undefined };
const secret = z.string().min(1).max(16_384).regex(/^[^\s\0]+$/);
const text = z.string().min(1).max(1024);
const sessionSchema = z.strictObject({
  version: z.literal(1), binding: bindingSchema, accessToken: secret, refreshToken: secret.nullable(),
  subject: text, nonce: secret, authTime: z.number().finite().nullable(),
  expiresAt: z.iso.datetime().nullable(), scopes: z.array(z.string().min(1).max(256)).max(256),
});
type Session = z.infer<typeof sessionSchema>;
const identity = z.object({ sub: text, name: z.string().max(1024).optional(), email: z.string().max(1024).optional(), email_verified: z.boolean().optional() });

async function connection(input: Input, runtime: Runtime) {
  const target = await loadProduct(input, runtime, "auth");
  const clientId = target.context.products.auth?.clientId;
  if (!clientId) throw new CliError("CONFIG_INVALID", "请配置已注册的 auth.clientId；CLI 使用 native public client 和 PKCE。");
  const metadata = await readDiscovery(target.endpoint, runtime);
  const fields: Record<string, string | string[] | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) if (value !== undefined) fields[key] = value;
  const as: oauth.AuthorizationServer = { ...fields, issuer: metadata.issuer };
  for (const endpoint of [as.authorization_endpoint, as.token_endpoint, as.jwks_uri, as.userinfo_endpoint, as.revocation_endpoint]) {
    if (endpoint && new URL(as.issuer).protocol === "https:" && new URL(endpoint).protocol !== "https:") throw new CliError("UPSTREAM_CONTRACT_MISMATCH", "HTTPS 身份服务不能将 OAuth 请求降级到 HTTP。");
  }
  const alg = ["EdDSA", "Ed25519", "ES256", "RS256", "PS256"].find(value => metadata.id_token_signing_alg_values_supported.includes(value));
  if (!as.token_endpoint || !as.userinfo_endpoint || !alg || !as.token_endpoint_auth_methods_supported?.includes("none")) throw new CliError("CAPABILITY_UNAVAILABLE", "当前部署未提供 CLI 所需的 public client、签名或 userinfo 能力。");
  const client: oauth.Client = { client_id: clientId, id_token_signed_response_alg: alg, [oauth.clockTolerance]: 0 };
  return { as, client, binding: credentialBinding(target.context, "auth-oauth"), options: requestOptions(runtime) };
}

async function readSession(runtime: Runtime, binding: CredentialBinding): Promise<Session> {
  const raw = await runtime.store.get(credentialKey(binding), runtime.signal);
  if (raw === undefined) throw new CliError("CREDENTIAL_REQUIRED", "请先运行 cina login 完成 CinaAuth 登录。");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new CliError("AUTHENTICATION_FAILED"); }
  const result = sessionSchema.safeParse(parsed);
  if (!result.success || credentialKey(result.data.binding) !== credentialKey(binding)) throw new CliError("AUTHENTICATION_FAILED");
  return result.data;
}

async function save(runtime: Runtime, session: Session) {
  await assertCurrentBinding(runtime, session.binding);
  await runtime.store.set(credentialKey(session.binding), JSON.stringify(sessionSchema.parse(session)), runtime.signal);
}

function tokenSession(tokens: oauth.TokenEndpointResponse, binding: CredentialBinding, subject: string, nonce: string, scopes: string[], previous?: Session): Session {
  if (tokens.token_type !== "bearer") throw new CliError("CAPABILITY_UNAVAILABLE", "当前 CLI 仅支持 Bearer OAuth 令牌。");
  const lifetime = tokens.expires_in;
  if (lifetime !== undefined && (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 315_360_000)) throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
  const granted = tokens.scope === undefined ? scopes : tokens.scope.split(" ");
  if (!granted.includes("openid") || granted.some(value => !scopes.includes(value))) throw new CliError("UPSTREAM_CONTRACT_MISMATCH", "令牌权限与请求范围不符。");
  const claims = oauth.getValidatedIdTokenClaims(tokens);
  return parseUpstream(sessionSchema, {
    version: 1, binding, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? null,
    subject, nonce, authTime: claims?.auth_time ?? previous?.authTime ?? null,
    expiresAt: lifetime === undefined ? null : new Date(Date.now() + lifetime * 1000).toISOString(), scopes: [...new Set(granted)],
  });
}

function checkClaims(claims: oauth.IDToken, client: oauth.Client) {
  if ((claims.azp !== undefined && claims.azp !== client.client_id) || claims.iat > Math.floor(Date.now() / 1000)) throw new CliError("AUTHENTICATION_FAILED", "ID token 的授权方或签发时间不符。");
}

async function userInfo(connected: Awaited<ReturnType<typeof connection>>, session: Session) {
  const { as, client, options } = connected;
  const response = await oauth.userInfoRequest(as, client, session.accessToken, options);
  const info = parseUpstream(identity, await oauth.processUserInfoResponse(as, client, session.subject, response));
  if (response.headers.get("content-type")?.split(";")[0]?.trim() === "application/jwt") await oauth.validateApplicationLevelSignature(as, response, options);
  return { issuer: as.issuer, subject: info.sub, name: info.name ?? null, email: info.email ?? null, emailVerified: info.email_verified ?? null, scopes: session.scopes, expiresAt: session.expiresAt };
}

export async function loginAuth(input: Input & { tokenStdin: boolean; secretStdin: boolean; noStore: boolean; noInput: boolean; vendor?: string | undefined }, runtime: Runtime) {
  if (input.credential || input.tokenStdin || input.secretStdin || input.vendor) throw new CliError("INVALID_ARGUMENT", "CinaAuth 使用浏览器 PKCE 登录，不接受其他产品的凭据参数。");
  if (input.noInput || !runtime.openBrowser) throw new CliError("CREDENTIAL_REQUIRED", "CinaAuth 浏览器登录需要交互终端；请在终端执行 cina login。");
  return safely(runtime, async () => {
    const connected = await connection(input, runtime);
    const { as, client, binding, options } = connected;
    if (!as.code_challenge_methods_supported?.includes("S256") || !as.response_types_supported?.includes("code") || !(as.grant_types_supported ?? ["authorization_code"]).includes("authorization_code")) throw new CliError("CAPABILITY_UNAVAILABLE");
    const scopes = ["openid", "profile", "email", "offline_access"].filter(value => as.scopes_supported?.includes(value));
    if (!scopes.includes("openid")) throw new CliError("CAPABILITY_UNAVAILABLE", "当前部署未声明 openid scope。");
    return withCredentialLock(runtime, binding, async () => {
      await assertCurrentBinding(runtime, binding);
      if (!input.noStore) await runtime.store.get(credentialKey(binding), runtime.signal);
      const listener = await listenForCallback(runtime.signal);
      try {
        const state = oauth.generateRandomState();
        const nonce = oauth.generateRandomNonce();
        const verifier = oauth.generateRandomCodeVerifier();
        const url = new URL(as.authorization_endpoint!);
        url.search = new URLSearchParams({ client_id: client.client_id, response_type: "code", response_mode: "query", redirect_uri: listener.redirectUri,
          scope: scopes.join(" "), state, nonce, code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", prompt: "consent" }).toString();
        await runtime.openBrowser!(url.href, runtime.signal);
        const params = oauth.validateAuthResponse(as, client, await listener.result, state);
        const response = await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, listener.redirectUri, verifier, options);
        const tokens = await oauth.processAuthorizationCodeResponse(as, client, response, { expectedNonce: nonce, requireIdToken: true });
        await oauth.validateApplicationLevelSignature(as, response, options);
        const claims = oauth.getValidatedIdTokenClaims(tokens)!;
        checkClaims(claims, client);
        const session = tokenSession(tokens, binding, claims.sub, nonce, scopes);
        await userInfo(connected, session);
        if (!input.noStore) await save(runtime, session);
        return { product: "auth", credential: "oauth", validated: true, saved: !input.noStore, source: "browser", expiresAt: session.expiresAt, principal: session.subject };
      } finally { await listener.dispose(); }
    });
  });
}

export async function authWhoami(input: Input, runtime: Runtime) {
  return safely(runtime, async () => {
    const connected = await connection(input, runtime);
    const session = await readSession(runtime, connected.binding);
    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) throw new CliError("TOKEN_EXPIRED", "访问令牌已过期，请执行 cina auth session refresh 或重新登录。");
    return userInfo(connected, session);
  });
}

export async function refreshAuth(input: Input, runtime: Runtime) {
  return safely(runtime, async () => {
    const connected = await connection(input, runtime);
    const { as, client, binding, options } = connected;
    if (!as.grant_types_supported?.includes("refresh_token")) throw new CliError("CAPABILITY_UNAVAILABLE");
    return withCredentialLock(runtime, binding, async () => {
      await assertCurrentBinding(runtime, binding);
      const previous = await readSession(runtime, binding);
      const refreshToken = previous.refreshToken;
      if (!refreshToken) throw new CliError("CREDENTIAL_REQUIRED", "此会话没有 refresh token，请重新登录。");
      try {
        return await safely(runtime, async () => {
          const response = await oauth.refreshTokenGrantRequest(as, client, oauth.None(), refreshToken, options);
          const tokens = await oauth.processRefreshTokenResponse(as, client, response);
          const claims = oauth.getValidatedIdTokenClaims(tokens);
          if (claims) {
            await oauth.validateApplicationLevelSignature(as, response, options);
            checkClaims(claims, client);
            if (claims.sub !== previous.subject || (claims.nonce !== undefined && claims.nonce !== previous.nonce) || (claims.auth_time !== undefined && claims.auth_time !== previous.authTime)) throw new CliError("AUTHENTICATION_FAILED", "刷新令牌的身份声明与原会话不符，请重新登录。");
          }
          const session = tokenSession(tokens, binding, previous.subject, previous.nonce, previous.scopes, previous);
          await userInfo(connected, session);
          await save(runtime, session);
          return { refreshed: true, issuer: as.issuer, subject: session.subject, expiresAt: session.expiresAt };
        });
      } catch (caught) {
        throw new CliError(safeError(caught).code, "刷新未完成，旧 refresh token 可能已失效；请重新执行 cina login，不要自动重放刷新。", { retryable: false });
      }
    });
  });
}

export async function logoutAuth(input: Input & { revoke: boolean }, runtime: Runtime) {
  if (input.credential) throw new CliError("INVALID_ARGUMENT");
  const target = await loadProduct(input, runtime, "auth");
  const binding = credentialBinding(target.context, "auth-oauth");
  return safely(runtime, () => withCredentialLock(runtime, binding, async () => {
    await assertCurrentBinding(runtime, binding);
    if (input.revoke) {
      const { as, client, options } = await connection(input, runtime);
      if (!as.revocation_endpoint || !as.revocation_endpoint_auth_methods_supported?.includes("none")) throw new CliError("CAPABILITY_UNAVAILABLE", "当前部署未声明 public client 撤销支持；可不带 --revoke 清理本机凭据。");
      const session = await readSession(runtime, binding);
      for (const [token, hint] of [[session.refreshToken, "refresh_token"], [session.accessToken, "access_token"]] as const) {
        if (token) await oauth.processRevocationResponse(await oauth.revocationRequest(as, client, oauth.None(), token, { ...options, additionalParameters: { token_type_hint: hint } }));
      }
    }
    await assertCurrentBinding(runtime, binding);
    await runtime.store.remove(credentialKey(binding), runtime.signal);
    return { product: "auth", removed: [{ credential: "oauth", localCleared: true }], remoteRevocation: input.revoke ? "requested" : "not-requested", environmentCredentialsPresent: false };
  }));
}
