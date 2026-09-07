import * as z from "zod";
import { define } from "./command.js";
import { productSchema } from "./context/schema.js";

const shape = { product: productSchema.default("auth"), credential: z.enum(["gateway", "management"]).optional() };
const flags = { product: { type: "string", field: "product" }, credential: { type: "string", field: "credential" } } as const;
export const sessionCommands = [
  define({
    id: "login", summary: "验证并保存产品凭据（当前支持 Token）", effect: "auth-state",
    contextRequirements: ["selected context", "product endpoint"],
    authentication: [{ scheme: "explicit-product-credential", scopes: [], permissions: ["Selected Gateway or Management key"] }],
    shape: { ...shape, tokenStdin: z.boolean().default(false), noStore: z.boolean().default(false) },
    flags: { ...flags, "token-stdin": { type: "boolean", field: "tokenStdin" }, "no-store": { type: "boolean", field: "noStore" } },
    output: z.strictObject({ product: z.literal("token"), credential: z.enum(["gateway", "management"]), validated: z.literal(true), saved: z.boolean(), source: z.enum(["stdin", "environment"]) }),
    run: async (input, runtime) => (await import("./session-handler.js")).login(input, runtime),
  }),
  define({
    id: "logout", summary: "移除当前环境的产品凭据（当前支持 Token）", effect: "auth-state",
    contextRequirements: ["selected context", "product endpoint"],
    shape, flags,
    output: z.strictObject({ product: z.literal("token"), removed: z.array(z.strictObject({ credential: z.enum(["gateway", "management"]), localCleared: z.boolean() })),
      remoteRevocation: z.literal("not-requested"), environmentCredentialsPresent: z.boolean() }),
    run: async (input, runtime) => (await import("./session-handler.js")).logout(input, runtime),
  }),
];
