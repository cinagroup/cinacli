import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { setTimeout as delay } from "node:timers/promises";
import { CliError } from "./errors.js";

/** A single deadline includes network attempts, response bodies and retry delays. */
export function deadline(milliseconds: number, parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason instanceof CliError ? parent.reason : new CliError("CANCELLED"));
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new CliError("TIMEOUT")), milliseconds);
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", cancel); } };
}

/** A connectivity probe opens only TCP/TLS; it sends no HTTP request or credential. */
export async function probeEndpoint(endpoint: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const url = new URL(endpoint);
  const secure = ["https:", "wss:"].includes(url.protocol);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  await new Promise<void>((resolve, reject) => {
    const socket = secure
      ? tlsConnect({ host, port: Number(url.port || 443), ...(url.hostname === host && !/^\d+(\.\d+){3}$/.test(host) ? { servername: host } : {}) })
      : tcpConnect({ host, port: Number(url.port || 80) });
    const finish = (error?: unknown) => {
      signal.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    socket.once(secure ? "secureConnect" : "connect", () => finish());
    socket.once("error", () => finish(new CliError("NETWORK_ERROR")));
    if (signal.aborted) abort();
  });
}

export interface JsonRequest {
  signal: AbortSignal;
  method?: "GET" | "POST";
  headers?: Readonly<Record<string, string>>;
  body?: string;
  /** Only adapters with a verified idempotent read contract may set this. */
  retryRead?: boolean;
  maxBytes?: number;
}

export async function requestJson(endpoint: string, options: JsonRequest): Promise<unknown> {
  const attempts = options.retryRead ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    options.signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: options.method ?? "GET", redirect: "manual", signal: options.signal,
        headers: { Accept: "application/json", ...options.headers },
        ...(options.body !== undefined ? { body: options.body } : {}),
      });
    } catch {
      if (options.signal.aborted) throw options.signal.reason;
      if (attempt + 1 === attempts) throw new CliError("NETWORK_ERROR");
      await pause(100 * 2 ** attempt, options.signal);
      continue;
    }
    if ((response.status === 429 || [502, 503, 504].includes(response.status)) && attempt + 1 < attempts) {
      await response.body?.cancel();
      const retryAfter = response.headers.get("retry-after");
      const milliseconds = retryAfter === null ? 100 * 2 ** attempt
        : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
      // Do not violate long Retry-After values by capping them to a shorter delay.
      if (!Number.isFinite(milliseconds) || milliseconds > 30_000) {
        throw new CliError(response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_UNAVAILABLE");
      }
      await pause(Math.max(0, milliseconds), options.signal);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new CliError("AUTHENTICATION_FAILED");
      if (response.status === 403) throw new CliError("PERMISSION_DENIED");
      if (response.status === 404) throw new CliError("RESOURCE_NOT_FOUND");
      if (response.status === 409) throw new CliError("CONFLICT");
      if (response.status === 429) throw new CliError("RATE_LIMITED");
      if (response.status === 501) throw new CliError("CAPABILITY_UNAVAILABLE");
      if (response.status >= 500) throw new CliError("UPSTREAM_UNAVAILABLE");
      throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
    }
    const maxBytes = options.maxBytes ?? 4_194_304;
    const reader = response.body?.getReader();
    if (!reader) throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new CliError("UPSTREAM_CONTRACT_MISMATCH", "上游响应超过大小限制。");
        chunks.push(chunk.value);
      }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
      catch { throw new CliError("UPSTREAM_CONTRACT_MISMATCH"); }
    } catch (error) {
      if (options.signal.aborted) throw options.signal.reason;
      if (error instanceof CliError) throw error;
      throw new CliError("NETWORK_ERROR");
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  throw new CliError("NETWORK_ERROR");
}

async function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  try { await delay(milliseconds, undefined, { signal }); }
  catch { if (signal.aborted) throw signal.reason; throw new CliError("NETWORK_ERROR"); }
}
