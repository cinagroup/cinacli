import * as z from "zod";
import { loadProduct, apiUrl, parseUpstream } from "../../core/product.js";
import { normalizeEndpoint } from "../../core/context/schema.js";
import { requestJson } from "../../core/transport.js";
import { CliError } from "../../core/errors.js";
import type { Runtime } from "../../core/command.js";

// Status never follows advertised endpoints or uses them to authenticate a user.
const endpoint = z.string().max(2048).refine(value => {
  try { normalizeEndpoint(value, "auth"); return true; } catch { return false; }
});
const names = z.array(z.string().min(1).max(256)).max(256);
export const discovery = z.object({
  issuer: endpoint, authorization_endpoint: endpoint, jwks_uri: endpoint,
  token_endpoint: endpoint.optional(), userinfo_endpoint: endpoint.optional(), revocation_endpoint: endpoint.optional(),
  response_types_supported: names, subject_types_supported: names, id_token_signing_alg_values_supported: names,
  grant_types_supported: names.optional(), code_challenge_methods_supported: names.optional(),
  token_endpoint_auth_methods_supported: names.optional(), scopes_supported: names.optional(),
  authorization_response_iss_parameter_supported: z.boolean().optional(),
  revocation_endpoint_auth_methods_supported: names.optional(),
});

export async function readDiscovery(endpoint: string, runtime: Runtime) {
  const metadata = parseUpstream(discovery, await requestJson(apiUrl(endpoint, ".well-known/openid-configuration"), { signal: runtime.signal, retryRead: true, maxBytes: 262_144 }));
  if (metadata.issuer !== endpoint) throw new CliError("PRECONDITION_FAILED", "身份服务元数据的 issuer 与配置不符。");
  return metadata;
}

export async function authStatus(input: { context?: string | undefined }, runtime: Runtime) {
  const target = await loadProduct(input, runtime, "auth");
  const metadata = await readDiscovery(target.endpoint, runtime);
  const grants = metadata.grant_types_supported ?? ["authorization_code", "implicit"];
  return {
    issuer: metadata.issuer, discovery: "validated",
    endpoints: { authorization: metadata.authorization_endpoint, token: metadata.token_endpoint ?? null, userinfo: metadata.userinfo_endpoint ?? null, jwks: metadata.jwks_uri, revocation: metadata.revocation_endpoint ?? null },
    advertised: {
      authorizationCode: Boolean(metadata.token_endpoint && grants.includes("authorization_code") && metadata.response_types_supported.includes("code")),
      pkceS256: metadata.code_challenge_methods_supported?.includes("S256") ?? false,
      publicClient: metadata.token_endpoint_auth_methods_supported?.includes("none") ?? false,
      refreshToken: grants.includes("refresh_token"), scopes: metadata.scopes_supported ?? [],
    },
    client: { configured: Boolean(target.context.products.auth?.clientId), registration: "not-verified" }, login: "browser-pkce",
  };
}
