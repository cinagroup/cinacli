import WebSocket from "ws";
import { newWebSocketRpcSession } from "capnweb";
import type { RpcStub } from "capnweb";
import { CliError } from "../../core/errors.js";
import type { Runtime } from "../../core/command.js";
import type { SeekPublic } from "./protocol.js";

export function seekError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : "";
  // Exact fallbacks are declared by workshop-shared AUTH_ERROR_MESSAGES, not substring heuristics.
  if (code === "INVALID_SESSION_TOKEN" || message === "invalid session token") return new CliError("AUTHENTICATION_FAILED");
  if (code === "NOT_AUTHENTICATED_WITH_ACCESS" || message === "Not authenticated with Access." || message === "This deployment requires Cloudflare Access authentication.") return new CliError("CAPABILITY_UNAVAILABLE", "当前 CLI 尚未接入 Cloudflare Access 身份获取流程。");
  return new CliError("UPSTREAM_RPC_ERROR");
}

/** One bounded RPC connection per invocation, with no reconnection or replay. */
export async function withSeek<T>(endpoint: string, runtime: Runtime, action: (api: RpcStub<SeekPublic>) => Promise<T>): Promise<T> {
  runtime.signal.throwIfAborted();
  const url = new URL(endpoint);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  // endpoint is the exact RPC path, normally /api; do not append /api to an arbitrary path.
  const socket = new WebSocket(url, { followRedirects: false, handshakeTimeout: 10_000, maxPayload: 4_194_304, perMessageDeflate: false });
  let networkError: CliError | undefined;
  let closing = false;
  let bytes = 0;
  socket.on("error", error => { networkError ??= new CliError("code" in error && error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" ? "UPSTREAM_CONTRACT_MISMATCH" : "NETWORK_ERROR"); });
  socket.on("close", () => { if (!closing) networkError ??= new CliError("NETWORK_ERROR"); });
  socket.on("unexpected-response", (_request, response) => {
    const status = response.statusCode ?? 0;
    networkError = [401, 403].includes(status) || (status >= 300 && status < 400)
      ? new CliError("CAPABILITY_UNAVAILABLE", "RPC 入口拒绝终端接入；请核对部署认证模式。Cloudflare Access 登录尚未支持。")
      : new CliError("UPSTREAM_UNAVAILABLE");
    response.resume(); socket.terminate();
  });
  socket.on("message", data => {
    bytes += Array.isArray(data) ? data.reduce((total, chunk) => total + chunk.byteLength, 0) : data.byteLength;
    if (bytes > 16_777_216) { networkError = new CliError("UPSTREAM_CONTRACT_MISMATCH", "RPC 会话响应超过大小限制。"); socket.terminate(); }
  });
  const cancel = () => socket.terminate();
  runtime.signal.addEventListener("abort", cancel, { once: true });
  // ws implements the event API actually used by Cap'n Web 0.12.0. Its typings lack
  // DOM dispatchEvent, which that transport does not call; keep the cast at this boundary.
  const api = newWebSocketRpcSession<SeekPublic>(socket as unknown as globalThis.WebSocket, undefined, { limits: { maxMessageSize: 4_194_304, maxDepth: 64, maxBigIntDigits: 128 } });
  try {
    if (runtime.signal.aborted) throw runtime.signal.reason;
    return await action(api);
  } catch (error) {
    if (runtime.signal.aborted) throw runtime.signal.reason;
    throw networkError ?? seekError(error);
  } finally {
    closing = true;
    runtime.signal.removeEventListener("abort", cancel);
    api[Symbol.dispose]();
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
}
