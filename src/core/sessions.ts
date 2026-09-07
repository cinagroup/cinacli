import * as z from "zod";
import { define } from "./command.js";
import { productSchema } from "./context/schema.js";

const shape = { product: productSchema.default("auth"), credential: z.enum(["gateway", "management"]).optional() };
const flags = { product: { type: "string", field: "product" }, credential: { type: "string", field: "credential" } } as const;
export const sessionCommands = [
  define({
    id: "login", summary: "登录 CinaAuth 或验证并保存产品凭据", effect: "auth-state", defaultTimeoutSeconds: 180,
    contextRequirements: ["selected context", "product endpoint"],
    authentication: [{ scheme: "selected-product-login", scopes: [], permissions: ["Auth native public client, Token key, Shop appid/appsecret, or Seek gatekeeper/session"] }],
    shape: { ...shape, tokenStdin: z.boolean().default(false), secretStdin: z.boolean().default(false), noStore: z.boolean().default(false), vendor: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional() },
    flags: { ...flags, "token-stdin": { type: "boolean", field: "tokenStdin" }, "secret-stdin": { type: "boolean", field: "secretStdin" }, "no-store": { type: "boolean", field: "noStore" }, vendor: { type: "string", field: "vendor" } },
    output: z.strictObject({ product: z.enum(["auth", "token", "shop", "seek"]), credential: z.enum(["oauth", "gateway", "management", "out", "session"]), validated: z.literal(true), saved: z.boolean(), source: z.enum(["stdin", "environment", "browser"]), expiresAt: z.iso.datetime().nullable(), principal: z.string().nullable() }),
    run: async (input, runtime) => (await import("./session-handler.js")).login(input, runtime),
  }),
  define({
    id: "logout", summary: "移除当前环境的产品凭据；Auth 可请求远程撤销", effect: "auth-state",
    contextRequirements: ["selected context", "product endpoint"],
    shape: { ...shape, revoke: z.boolean().default(false) }, flags: { ...flags, revoke: { type: "boolean", field: "revoke" } },
    output: z.strictObject({ product: z.enum(["auth", "token", "shop", "seek"]), removed: z.array(z.strictObject({ credential: z.enum(["oauth", "gateway", "management", "out", "session"]), localCleared: z.boolean() })),
      remoteRevocation: z.enum(["not-requested", "not-supported", "requested"]), environmentCredentialsPresent: z.boolean() }),
    run: async (input, runtime) => (await import("./session-handler.js")).logout(input, runtime),
  }),
];
