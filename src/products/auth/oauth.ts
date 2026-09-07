import * as oauth from "oauth4webapi";
import { normalizeEndpoint } from "../../core/context/schema.js";
import { CliError } from "../../core/errors.js";
import type { Runtime } from "../../core/command.js";

/** No redirects, retries or unbounded bodies on any OAuth request, including JWKS. */
export function requestOptions(runtime: Runtime) {
  return {
    signal: runtime.signal,
    // Every URL is independently constrained to HTTPS or literal loopback by customFetch.
    [oauth.allowInsecureRequests]: true,
    [oauth.customFetch]: async (url: string, init: oauth.CustomFetchOptions<string, URLSearchParams | undefined>) => {
      try { normalizeEndpoint(url, "auth"); }
      catch { throw new CliError("UPSTREAM_CONTRACT_MISMATCH"); }
      let response: Response;
      try { response = await fetch(url, { method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }), signal: runtime.signal, redirect: "manual" }); }
      catch { if (runtime.signal.aborted) throw runtime.signal.reason; throw new CliError("NETWORK_ERROR", undefined, { retryable: false }); }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel(); throw new CliError("UPSTREAM_CONTRACT_MISMATCH", "OAuth 端点不允许重定向。");
      }
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel(); throw new CliError(response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_UNAVAILABLE", undefined, { retryable: false });
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        if (reader) while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > 262_144) throw new CliError("UPSTREAM_CONTRACT_MISMATCH", "OAuth 响应超过大小限制。");
          chunks.push(part.value);
        }
      } catch (error) {
        if (runtime.signal.aborted) throw runtime.signal.reason;
        if (error instanceof CliError) throw error;
        throw new CliError("NETWORK_ERROR", undefined, { retryable: false });
      } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
      return new Response(response.status === 204 ? null : Buffer.concat(chunks), { status: response.status, headers: response.headers });
    },
  };
}

export async function safely<T>(runtime: Runtime, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof CliError) throw error;
    if (runtime.signal.aborted) throw runtime.signal.reason;
    if (error instanceof oauth.AuthorizationResponseError && error.error === "access_denied") throw new CliError("PERMISSION_DENIED", "用户或身份服务拒绝授权。");
    if (error instanceof oauth.ResponseBodyError) {
      if (error.error === "unsupported_token_type" || error.error === "unsupported_grant_type") throw new CliError("CAPABILITY_UNAVAILABLE");
      if (["invalid_client", "invalid_grant", "invalid_token"].includes(error.error)) throw new CliError("AUTHENTICATION_FAILED", "OAuth 凭据无效或已撤销，请重新登录。");
    }
    if (error instanceof oauth.UnsupportedOperationError) throw new CliError("CAPABILITY_UNAVAILABLE");
    if (error instanceof oauth.WWWAuthenticateChallengeError) throw new CliError("AUTHENTICATION_FAILED");
    throw new CliError("AUTHENTICATION_FAILED", "OAuth 响应、令牌声明或签名验证失败。");
  }
}
