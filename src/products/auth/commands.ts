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
    login: z.literal("not-implemented"),
  }),
  run: async (input, runtime) => (await import("./handler.js")).authStatus(input, runtime),
})];
