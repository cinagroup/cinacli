import type { ReadStream } from "node:tty";
import { CliError } from "./errors.js";

/** Explicit, bounded pipe input only. Interactive terminal input must never echo a secret. */
export async function readSecretInput(stream: ReadStream, signal: AbortSignal): Promise<string> {
  if (stream.isTTY) throw new CliError("INVALID_ARGUMENT", "--token-stdin 需要管道输入；终端可使用凭据环境变量。");
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      stream.pause(); stream.removeListener("data", data); stream.removeListener("end", end); stream.removeListener("error", error);
      signal.removeEventListener("abort", abort);
    };
    const fail = (reason: unknown) => { cleanup(); reject(reason); };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_386) fail(new CliError("INVALID_ARGUMENT", "凭据输入超过大小限制。"));
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "")); };
    const error = () => fail(new CliError("INVALID_ARGUMENT", "无法读取凭据输入。"));
    const abort = () => fail(signal.reason);
    stream.on("data", data); stream.once("end", end); stream.once("error", error); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else stream.resume();
  });
}
