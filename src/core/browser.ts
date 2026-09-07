import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliError } from "./errors.js";

const execute = promisify(execFile);

/** Open a service-provided web login in the system browser, without a command shell. */
export async function openSystemBrowser(value: string, signal: AbortSignal): Promise<void> {
  let url: URL;
  try { url = new URL(value); } catch { throw new CliError("UPSTREAM_CONTRACT_MISMATCH"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value) || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) throw new CliError("UPSTREAM_CONTRACT_MISMATCH", "登录服务返回的浏览器地址无效。");
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url.href] : [url.href];
  try { await execute(command, args, { windowsHide: true, signal, maxBuffer: 65_536 }); }
  catch { if (signal.aborted) throw signal.reason; throw new CliError("CAPABILITY_UNAVAILABLE", "无法启动系统浏览器；请在支持浏览器的终端登录，或通过显式产品会话凭据接入。"); }
}
