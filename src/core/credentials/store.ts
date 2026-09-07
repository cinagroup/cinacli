import { createHash, randomUUID } from "node:crypto";
import * as z from "zod";
import { CliError } from "../errors.js";
import { contextNameSchema, productEndpoint, productSchema } from "../context/schema.js";
import type { Context, Product } from "../context/schema.js";
import type { Environment } from "../context/store.js";

const schemes = {
  "auth-oauth": { product: "auth", variable: undefined },
  "token-gateway": { product: "token", variable: "CINA_TOKEN_GATEWAY_KEY" },
  "token-management": { product: "token", variable: "CINA_TOKEN_MANAGEMENT_KEY" },
  "shop-out": { product: "shop", variable: "CINA_SHOP_ACCESS_TOKEN" },
  "seek-session": { product: "seek", variable: "CINA_SEEK_SESSION_TOKEN" },
  "chain-rpc": { product: "chain", variable: "CINA_CHAIN_RPC_KEY" },
} as const;
export type CredentialScheme = keyof typeof schemes;
const schemeSchema = z.enum(Object.keys(schemes) as [CredentialScheme, ...CredentialScheme[]]);
const bindingSchema = z.strictObject({
  contextId: z.uuid(),
  contextName: contextNameSchema,
  epoch: z.number().int().nonnegative().safe(),
  product: productSchema,
  endpoint: z.string(),
  scheme: schemeSchema,
});
export type CredentialBinding = z.infer<typeof bindingSchema>;
const secretSchema = z.string().min(1).max(16_384).refine((value) => !/[\r\n\0]/.test(value));
const credentialSchema = z.strictObject({
  version: z.literal(1),
  binding: bindingSchema,
  secret: secretSchema,
  principal: z.string().nullable(),
  scopes: z.array(z.string()),
  expiresAt: z.iso.datetime().nullable(),
});
export type Credential = z.infer<typeof credentialSchema>;

export interface SecretStore {
  get(key: string, signal?: AbortSignal): Promise<string | undefined>;
  set(key: string, value: string, signal?: AbortSignal): Promise<void>;
  remove(key: string, signal?: AbortSignal): Promise<boolean>;
}

/** Loads the optional native module only when a credential operation is requested. */
export function systemSecretStore(service = "cinacli/v1"): SecretStore {
  async function entry(key: string) {
    try {
      const { AsyncEntry } = await import("@napi-rs/keyring");
      return new AsyncEntry(service, key);
    } catch { throw new CliError("CAPABILITY_UNAVAILABLE", "系统凭据库不可用；可使用显式环境变量，不会写入明文凭据。"); }
  }
  async function safely<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      signal?.throwIfAborted();
      return await operation();
    } catch {
      if (signal?.aborted) throw signal.reason;
      throw new CliError("CAPABILITY_UNAVAILABLE", "系统凭据库不可用或已锁定；凭据未回退到明文文件。");
    }
  }
  return {
    get: (key, signal) => safely(async () => (await (await entry(key)).getPassword(signal)) ?? undefined, signal),
    set: (key, value, signal) => safely(async () => (await entry(key)).setPassword(value, signal), signal),
    remove: (key, signal) => safely(async () => (await entry(key)).deleteCredential(signal), signal),
  };
}

export async function probeSecretStore(store: SecretStore, signal?: AbortSignal): Promise<boolean> {
  try {
    await store.get(`probe-${randomUUID()}`, signal);
    return true;
  } catch {
    if (signal?.aborted) throw signal.reason;
    return false;
  }
}

export function credentialBinding(context: Context, scheme: CredentialScheme): CredentialBinding {
  const product: Product = schemes[scheme].product;
  const endpoint = productEndpoint(context, product);
  if (!endpoint) throw new CliError("CONFIG_INVALID", "请先配置所选产品的端点。");
  return {
    contextId: context.id, contextName: context.name,
    epoch: context.credentialEpochs[product] ?? 0, product, endpoint, scheme,
  };
}

export function credentialKey(binding: CredentialBinding): string {
  const parsed = bindingSchema.parse(binding);
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

export async function saveCredential(store: SecretStore, credential: Credential, signal?: AbortSignal): Promise<void> {
  const parsed = credentialSchema.safeParse(credential);
  if (!parsed.success || schemes[credential.binding.scheme].product !== credential.binding.product) {
    throw new CliError("INVALID_ARGUMENT", "凭据元数据无效。");
  }
  await store.set(credentialKey(parsed.data.binding), JSON.stringify(parsed.data), signal);
}

/** Environment credentials are an explicit, process-local override for the selected binding. */
export async function resolveCredential(
  store: SecretStore, binding: CredentialBinding, env: Environment, signal?: AbortSignal,
): Promise<{ credential: Credential; source: "environment" | "keyring" }> {
  if (schemes[binding.scheme].product !== binding.product) throw new CliError("INVALID_ARGUMENT");
  const variable = schemes[binding.scheme].variable;
  const supplied = variable ? env[variable] : undefined;
  if (supplied !== undefined) {
    if (!secretSchema.safeParse(supplied).success) throw new CliError("CREDENTIAL_REQUIRED", "显式凭据变量为空或格式无效，不会回退使用已保存凭据。");
    return { source: "environment", credential: { version: 1, binding, secret: supplied, principal: null, scopes: [], expiresAt: null } };
  }
  const raw = await store.get(credentialKey(binding), signal);
  if (raw === undefined) throw new CliError("CREDENTIAL_REQUIRED");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new CliError("AUTHENTICATION_FAILED"); }
  const parsed = credentialSchema.safeParse(value);
  if (!parsed.success || credentialKey(parsed.data.binding) !== credentialKey(binding)) throw new CliError("AUTHENTICATION_FAILED");
  if (parsed.data.expiresAt && Date.parse(parsed.data.expiresAt) <= Date.now()) throw new CliError("TOKEN_EXPIRED");
  return { source: "keyring", credential: parsed.data };
}
