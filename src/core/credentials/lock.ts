import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CliError, hasErrorCode } from "../errors.js";
import { credentialKey } from "./store.js";
import type { CredentialBinding } from "./store.js";
import type { Runtime } from "../command.js";
import { readConfig, selectContext } from "../context/store.js";
import { credentialBinding } from "./store.js";

export async function assertCurrentBinding(runtime: Runtime, binding: CredentialBinding): Promise<void> {
  const current = selectContext(await readConfig(runtime.directory()), binding.contextName, {});
  if (credentialKey(credentialBinding(current, binding.scheme)) !== credentialKey(binding)) throw new CliError("CONFLICT", "认证期间产品配置发生变化，请重试。");
  runtime.signal.throwIfAborted();
}

/** Serialize local credential mutations before any rotating authentication request. */
export async function withCredentialLock<T>(runtime: Runtime, binding: CredentialBinding, action: () => Promise<T>): Promise<T> {
  runtime.signal.throwIfAborted();
  const path = join(runtime.directory(), `credential-${credentialKey(binding)}.lock`);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    await mkdir(runtime.directory(), { recursive: true, mode: 0o700 });
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) throw new CliError("CONFLICT", "凭据正被另一进程使用；异常退出遗留的 credential-*.lock 需确认后手动清理。");
    throw new CliError("CONFIG_IO_ERROR");
  }
  try { runtime.signal.throwIfAborted(); return await action(); }
  finally { await handle.close(); await unlink(path).catch(() => {}); }
}

/** Acquire every selected binding before mutating any of them (e.g. Token logout). */
export async function withCredentialLocks<T>(runtime: Runtime, bindings: readonly CredentialBinding[], action: () => Promise<T>): Promise<T> {
  const unique = new Map(bindings.map(binding => [credentialKey(binding), binding]));
  const ordered = [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, binding]) => binding);
  const acquire = (index: number): Promise<T> => {
    const binding = ordered[index];
    return binding ? withCredentialLock(runtime, binding, () => acquire(index + 1)) : action();
  };
  return acquire(0);
}
