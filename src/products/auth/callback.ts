import { createServer } from "node:http";
import { CliError } from "../../core/errors.js";

/** A single-use, IPv4 loopback listener; never renders callback parameters. */
export async function listenForCallback(signal: AbortSignal) {
  signal.throwIfAborted();
  let resolveResult!: (url: URL) => void;
  let rejectResult!: (error: unknown) => void;
  const result = { promise: new Promise<URL>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; }), resolve: (url: URL) => resolveResult(url), reject: (error: unknown) => rejectResult(error) };
  // Cancellation can precede the caller awaiting the callback (e.g. browser startup).
  void result.promise.catch(() => {});
  let redirectUri = "";
  let received = false;
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Connection", "close");
    const raw = request.url ?? "";
    if (request.method !== "GET" || !raw.startsWith("/callback?") || raw.length > 8192 || request.headers.host !== new URL(redirectUri).host) {
      response.writeHead(400).end("Invalid callback."); return;
    }
    if (received) { response.writeHead(409).end("Callback already received."); return; }
    const url = new URL(raw, redirectUri);
    if (url.pathname !== "/callback" || url.hash) { response.writeHead(400).end("Invalid callback."); return; }
    received = true;
    response.end("Authorization response received. Return to your terminal to check the result.");
    result.resolve(url);
  });
  const abort = () => { result.reject(signal.reason); server.closeAllConnections(); server.close(); };
  server.on("error", () => result.reject(new CliError("CAPABILITY_UNAVAILABLE", "无法启动本机授权回调监听。")));
  await new Promise<void>((resolve, reject) => {
    const failed = () => reject(new CliError("CAPABILITY_UNAVAILABLE", "无法启动本机授权回调监听。"));
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", failed); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new CliError("INTERNAL_ERROR"); }
  redirectUri = `http://127.0.0.1:${address.port}/callback`;
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return { redirectUri, result: result.promise, dispose: async () => {
    signal.removeEventListener("abort", abort);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
