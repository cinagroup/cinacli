import * as z from "zod";
import { define } from "../../core/command.js";

export const authCommands = [define({
  id: "auth.status", summary: "读取并核对身份服务的 OIDC 元数据", effect: "business-read", retryPolicy: "idempotent-read",
  contextRequirements: ["selected context", "auth.issuer"], shape: {},
  output: z.strictObject({
    issuer: z.string(), discovery: z.literal("validated"),
    endpoints: z.strictObject({ authorization: z.string(), token: z.string().nullable(), userinfo: z.string().nullable(), jwks: z.string(), revocation: z.string().nullable() }),
    advertised: z.strictObject({ authorizationCode: z.boolean(), pkceS256: z.boolean(), publicClient: z.boolean(), refreshToken: z.boolean(), scopes: z.array(z.string()) }),
    client: z.strictObject({ configured: z.boolean(), registration: z.literal("not-verified") }),
    login: z.literal("browser-pkce"),
  }),
  run: async (input, runtime) => (await import("./handler.js")).authStatus(input, runtime),
}),
...(["whoami", "auth.whoami"] as const).map(id => define({
  id, summary: "读取并核对 CinaAuth 当前用户身份", effect: "business-read",
  contextRequirements: ["selected context", "auth.issuer", "auth.clientId"],
  authentication: [{ scheme: "auth-oauth", scopes: ["openid"], permissions: ["OIDC identity only"] }], shape: {},
  output: z.strictObject({ issuer: z.string(), subject: z.string(), name: z.string().nullable(), email: z.string().nullable(), emailVerified: z.boolean().nullable(), scopes: z.array(z.string()), expiresAt: z.iso.datetime().nullable() }),
  run: async (input, runtime) => (await import("./session.js")).authWhoami(input, runtime),
})),
define({
  id: "auth.session.refresh", summary: "刷新 CinaAuth 令牌并保存轮换后的凭据", effect: "auth-state",
  contextRequirements: ["selected context", "auth.issuer", "auth.clientId"],
  authentication: [{ scheme: "auth-oauth", scopes: ["offline_access"], permissions: ["saved refresh token"] }], shape: {},
  output: z.strictObject({ refreshed: z.literal(true), issuer: z.string(), subject: z.string(), expiresAt: z.iso.datetime().nullable() }),
  run: async (input, runtime) => (await import("./session.js")).refreshAuth(input, runtime),
})];
