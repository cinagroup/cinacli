import * as z from "zod";
import { define } from "./command.js";
import { productSchema } from "./context/schema.js";

const shape = { product: productSchema.default("auth"), credential: z.enum(["gateway", "management"]).optional() };
const flags = { product: { type: "string", field: "product" }, credential: { type: "string", field: "credential" } } as const;
export const sessionCommands = [
  define({
    id: "login", summary: "验证并保存产品凭据（Token、Shop、Seek）", effect: "auth-state", defaultTimeoutSeconds: 180,
    contextRequirements: ["selected context", "product endpoint"],
    authentication: [{ scheme: "explicit-product-credential", scopes: [], permissions: ["Token key, Shop appid/appsecret, or Seek gatekeeper/session"] }],
    shape: { ...shape, tokenStdin: z.boolean().default(false), secretStdin: z.boolean().default(false), noStore: z.boolean().default(false), vendor: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional() },
    flags: { ...flags, "token-stdin": { type: "boolean", field: "tokenStdin" }, "secret-stdin": { type: "boolean", field: "secretStdin" }, "no-store": { type: "boolean", field: "noStore" }, vendor: { type: "string", field: "vendor" } },
    output: z.strictObject({ product: z.enum(["token", "shop", "seek"]), credential: z.enum(["gateway", "management", "out", "session"]), validated: z.literal(true), saved: z.boolean(), source: z.enum(["stdin", "environment", "browser"]), expiresAt: z.iso.datetime().nullable(), principal: z.string().nullable() }),
    run: async (input, runtime) => (await import("./session-handler.js")).login(input, runtime),
  }),
  define({
    id: "logout", summary: "移除当前环境的产品凭据（Token、Shop、Seek）", effect: "auth-state",
    contextRequirements: ["selected context", "product endpoint"],
    shape, flags,
    output: z.strictObject({ product: z.enum(["token", "shop", "seek"]), removed: z.array(z.strictObject({ credential: z.enum(["gateway", "management", "out", "session"]), localCleared: z.boolean() })),
      remoteRevocation: z.enum(["not-requested", "not-supported"]), environmentCredentialsPresent: z.boolean() }),
    run: async (input, runtime) => (await import("./session-handler.js")).logout(input, runtime),
  }),
];
