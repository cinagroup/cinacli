import * as z from "zod";
import { loadProduct, parseUpstream } from "../../core/product.js";
import { credentialBinding, credentialKey, saveCredential } from "../../core/credentials/store.js";
import { assertCurrentBinding, withCredentialLock } from "../../core/credentials/lock.js";
import { CliError } from "../../core/errors.js";
import { withSeek } from "./transport.js";
import { serverConfig, user } from "./protocol.js";
import type { Runtime } from "../../core/command.js";

type Input = { context?: string | undefined; credential?: string | undefined };
type LoginInput = Input & { tokenStdin: boolean; secretStdin: boolean; noStore: boolean; noInput: boolean; vendor?: string | undefined };
const tokenSchema = z.string().min(1).max(16_384).regex(/^[^\s\0]+$/);
const browserUrl = z.string().max(8192).refine(value => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !/[\x00-\x1f\x7f]/.test(value) && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
});

export async function loginSeek(input: LoginInput, runtime: Runtime) {
  if (input.credential || input.secretStdin) throw new CliError("INVALID_ARGUMENT", "Seek 使用独立 session token 或 --vendor 浏览器登录。");
  const fromEnvironment = runtime.env.CINA_SEEK_SESSION_TOKEN;
  if ((input.tokenStdin && fromEnvironment !== undefined) || (input.vendor && (input.tokenStdin || fromEnvironment !== undefined))) throw new CliError("INVALID_ARGUMENT", "请只选择一种 Seek 登录来源：浏览器、stdin 或环境变量。");
  const supplied = input.tokenStdin || fromEnvironment !== undefined;
  if (!supplied && (input.noInput || !runtime.openBrowser)) throw new CliError("CREDENTIAL_REQUIRED", "浏览器登录需要交互终端；自动化可通过 CINA_SEEK_SESSION_TOKEN 或 --token-stdin 提供已有会话。");
  if (!supplied && !input.vendor) throw new CliError("INVALID_ARGUMENT", "请先执行 seek status，再用 --vendor 选择登录方式。");
  if (input.tokenStdin && !runtime.readSecret) throw new CliError("CREDENTIAL_REQUIRED");
  const suppliedToken = input.tokenStdin ? await runtime.readSecret!(runtime.signal) : fromEnvironment;
  if (supplied && !tokenSchema.safeParse(suppliedToken).success) throw new CliError("CREDENTIAL_REQUIRED");
  const target = await loadProduct(input, runtime, "seek");
  const binding = credentialBinding(target.context, "seek-session");
  return withCredentialLock(runtime, binding, async () => {
    await assertCurrentBinding(runtime, binding);
    if (!input.noStore) await runtime.store.get(credentialKey(binding), runtime.signal);
    return withSeek(target.endpoint, runtime, async api => {
      let secret = suppliedToken;
      if (!supplied) {
        using config = await api.getServerConfig();
        const available = parseUpstream(serverConfig, config);
        if (!available.authVendors.some(value => value.vendorId === input.vendor)) throw new CliError("CAPABILITY_UNAVAILABLE", "所选登录方式未由当前部署提供。");
        using started = await api.startGatekeeperLogin(input.vendor!);
        const url = parseUpstream(browserUrl, started.url);
        await runtime.openBrowser!(url, runtime.signal);
        secret = parseUpstream(tokenSchema, await started.attempt.wait());
      }
      using authenticated = await api.authenticate(secret!);
      using identity = await authenticated.whoami();
      const principal = parseUpstream(user, identity).id;
      if (!input.noStore) {
        await assertCurrentBinding(runtime, binding);
        await saveCredential(runtime.store, { version: 1, binding, secret: secret!, principal, scopes: [], expiresAt: null }, runtime.signal);
      }
      return { product: "seek", credential: "session", validated: true, saved: !input.noStore, source: supplied ? input.tokenStdin ? "stdin" : "environment" : "browser", expiresAt: null, principal };
    });
  });
}

export async function logoutSeek(input: Input, runtime: Runtime) {
  if (input.credential) throw new CliError("INVALID_ARGUMENT");
  const target = await loadProduct(input, runtime, "seek");
  const binding = credentialBinding(target.context, "seek-session");
  await withCredentialLock(runtime, binding, async () => { await assertCurrentBinding(runtime, binding); await runtime.store.remove(credentialKey(binding), runtime.signal); });
  return { product: "seek", removed: [{ credential: "session", localCleared: true }], remoteRevocation: "not-supported", environmentCredentialsPresent: runtime.env.CINA_SEEK_SESSION_TOKEN !== undefined };
}
