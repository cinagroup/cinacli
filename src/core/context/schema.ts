import * as z from "zod";

export const products = ["auth", "token", "shop", "seek", "chain"] as const;
export const productSchema = z.enum(products);
export type Product = z.infer<typeof productSchema>;
export const contextNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
export const identifierSchema = z.string().min(1).max(256).regex(/^[a-zA-Z0-9._:@/-]+$/);

/** Endpoints may contain service paths, but never userinfo, query credentials or fragments. */
export function normalizeEndpoint(value: string, product: Product): string {
  const url = new URL(value);
  const protocols = product === "seek" ? ["https:", "http:", "wss:", "ws:"] : ["https:", "http:"];
  if (!protocols.includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid endpoint");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (["http:", "ws:"].includes(url.protocol) && !loopback) throw new Error("TLS required");
  return url.href.replace(/\/+$/, "");
}

function endpointSchema(product: Product) {
  return z.string().max(2048).refine((value) => {
    try { return normalizeEndpoint(value, product) === value; } catch { return false; }
  }, "Invalid endpoint");
}

export const fieldSchemas = {
  "auth.issuer": endpointSchema("auth"),
  "auth.apiBase": endpointSchema("auth"),
  "auth.clientId": identifierSchema,
  "auth.organizationId": identifierSchema,
  "token.endpoint": endpointSchema("token"),
  "token.workspaceId": identifierSchema,
  "shop.endpoint": endpointSchema("shop"),
  "shop.accountId": identifierSchema,
  "seek.endpoint": endpointSchema("seek"),
  "seek.workspaceId": identifierSchema,
  "chain.endpoint": endpointSchema("chain"),
  "chain.chainId": z.number().int().positive().safe(),
} as const;
export type ConfigKey = keyof typeof fieldSchemas;
export const configKeys = Object.keys(fieldSchemas) as ConfigKey[];

export const productConfigSchema = z.strictObject({
  auth: z.strictObject({
    issuer: fieldSchemas["auth.issuer"].optional(),
    apiBase: fieldSchemas["auth.apiBase"].optional(),
    clientId: identifierSchema.optional(),
    organizationId: identifierSchema.optional(),
  }).optional(),
  token: z.strictObject({ endpoint: fieldSchemas["token.endpoint"].optional(), workspaceId: identifierSchema.optional() }).optional(),
  shop: z.strictObject({ endpoint: fieldSchemas["shop.endpoint"].optional(), accountId: identifierSchema.optional() }).optional(),
  seek: z.strictObject({ endpoint: fieldSchemas["seek.endpoint"].optional(), workspaceId: identifierSchema.optional() }).optional(),
  chain: z.strictObject({ endpoint: fieldSchemas["chain.endpoint"].optional(), chainId: fieldSchemas["chain.chainId"].optional() }).optional(),
});

export const contextSchema = z.strictObject({
  id: z.uuid(),
  name: contextNameSchema,
  products: productConfigSchema,
  credentialEpochs: z.partialRecord(productSchema, z.number().int().nonnegative().safe()),
});
export type Context = z.infer<typeof contextSchema>;
export const publicContextSchema = contextSchema.omit({ id: true, credentialEpochs: true });
export const configSchema = z.strictObject({
  version: z.literal(1),
  current: contextNameSchema.nullable(),
  contexts: z.array(contextSchema).max(100),
}).superRefine((config, ctx) => {
  if (new Set(config.contexts.map((item) => item.name)).size !== config.contexts.length ||
      new Set(config.contexts.map((item) => item.id)).size !== config.contexts.length ||
      (config.current !== null && !config.contexts.some((item) => item.name === config.current))) {
    ctx.addIssue({ code: "custom", message: "Invalid context references" });
  }
});
export type Config = z.infer<typeof configSchema>;

export function publicContext(context: Context): z.infer<typeof publicContextSchema> {
  return { name: context.name, products: context.products };
}

export function productEndpoint(context: Context, product: Product): string | undefined {
  return product === "auth" ? context.products.auth?.issuer : context.products[product]?.endpoint;
}
