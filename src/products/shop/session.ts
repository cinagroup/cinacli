import * as z from "zod";
import { CliError, safeError } from "../../core/errors.js";
import { loadProduct, parseUpstream } from "../../core/product.js";
import { credentialBinding, credentialKey, resolveCredential, saveCredential } from "../../core/credentials/store.js";
import { assertCurrentBinding, withCredentialLock } from "../../core/credentials/lock.js";
import { assertAccount, shopRequest } from "./handler.js";
import type { Runtime } from "../../core/command.js";

type Input = { context?: string | undefined };
const token = z.string().min(1).max(16_384).regex(/^[^\s\0]+$/);
const issuedToken = z.object({ access_token: token, token: token.optional(), exp_time: z.number().int().positive().max(253_402_300_799) });
const accountInfo = z.object({ id: z.number().int().positive().safe(), appid: z.string().min(1).max(50) });

function validateIssued<T extends z.infer<typeof issuedToken>>(issued: T): T {
  if ((issued.token !== undefined && issued.token !== issued.access_token) || issued.exp_time * 1000 <= Date.now()) throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
  return issued;
}

export async function loginShop(input: Input & { credential?: string | undefined; tokenStdin: boolean; secretStdin: boolean; noStore: boolean }, runtime: Runtime) {
  if (input.credential || input.tokenStdin) throw new CliError("INVALID_ARGUMENT", "Shop 登录使用 appid/appsecret；管道输入使用 --secret-stdin。");
  if (runtime.env.CINA_SHOP_ACCESS_TOKEN !== undefined) throw new CliError("INVALID_ARGUMENT", "请先移除 CINA_SHOP_ACCESS_TOKEN 覆盖，再登录并保存新会话。");
  const target = await loadProduct(input, runtime, "shop");
  const appid = runtime.env.CINA_SHOP_APP_ID;
  if (!appid || appid.length > 50 || appid.trim() !== appid || /[\x00-\x1f\x7f]/.test(appid)) throw new CliError("CREDENTIAL_REQUIRED", "请通过 CINA_SHOP_APP_ID 提供开放接口 appid。");
  if (input.secretStdin && runtime.env.CINA_SHOP_APP_SECRET !== undefined) throw new CliError("INVALID_ARGUMENT", "请只提供一种 appsecret 来源：stdin 或 CINA_SHOP_APP_SECRET。");
  if (input.secretStdin && !runtime.readSecret) throw new CliError("CREDENTIAL_REQUIRED");
  const secret = input.secretStdin ? await runtime.readSecret!(runtime.signal) : runtime.env.CINA_SHOP_APP_SECRET;
  if (!secret || secret.length > 128 || /[\x00-\x1f\x7f]/.test(secret)) throw new CliError("CREDENTIAL_REQUIRED", "请通过 CINA_SHOP_APP_SECRET 或 --secret-stdin 提供 appsecret。");
  const binding = credentialBinding(target.context, "shop-out");
  return withCredentialLock(runtime, binding, async () => {
    await assertCurrentBinding(runtime, binding);
    if (!input.noStore) await runtime.store.get(credentialKey(binding), runtime.signal);
    const issued = validateIssued(parseUpstream(issuedToken.extend({ auth_info: accountInfo }), await shopRequest(target.endpoint, "get_token", runtime, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appid, appsecret: secret }),
    })));
    if (issued.auth_info.appid !== appid) throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
    const credential = { version: 1 as const, binding, secret: issued.access_token, principal: String(issued.auth_info.id), scopes: [], expiresAt: new Date(issued.exp_time * 1000).toISOString() };
    assertAccount(target.context, credential);
    if (!input.noStore) { await assertCurrentBinding(runtime, binding); await saveCredential(runtime.store, credential, runtime.signal); }
    return { product: "shop", credential: "out", validated: true, saved: !input.noStore, source: input.secretStdin ? "stdin" : "environment", expiresAt: credential.expiresAt, principal: credential.principal };
  });
}

export async function logoutShop(input: Input & { credential?: string | undefined }, runtime: Runtime) {
  if (input.credential) throw new CliError("INVALID_ARGUMENT");
  const target = await loadProduct(input, runtime, "shop");
  const binding = credentialBinding(target.context, "shop-out");
  await withCredentialLock(runtime, binding, async () => {
    await assertCurrentBinding(runtime, binding);
    await runtime.store.remove(credentialKey(binding), runtime.signal);
  });
  return { product: "shop", removed: [{ credential: "out", localCleared: true }], remoteRevocation: "not-supported", environmentCredentialsPresent: runtime.env.CINA_SHOP_ACCESS_TOKEN !== undefined };
}

export async function refreshShop(input: Input, runtime: Runtime) {
  if (runtime.env.CINA_SHOP_ACCESS_TOKEN !== undefined) throw new CliError("PRECONDITION_FAILED", "刷新仅支持系统凭据库中的会话；请先移除环境变量覆盖并登录。");
  const target = await loadProduct(input, runtime, "shop");
  const binding = credentialBinding(target.context, "shop-out");
  return withCredentialLock(runtime, binding, async () => {
    await assertCurrentBinding(runtime, binding);
    const { credential } = await resolveCredential(runtime.store, binding, {}, runtime.signal);
    assertAccount(target.context, credential);
    try {
      // The upstream clears the old token first. Never automatically retry this request.
      const issued = validateIssued(parseUpstream(issuedToken, await shopRequest(target.endpoint, "refresh_token", runtime, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: credential.secret }),
      })));
      const expiresAt = new Date(issued.exp_time * 1000).toISOString();
      await assertCurrentBinding(runtime, binding);
      await saveCredential(runtime.store, { ...credential, secret: issued.access_token, expiresAt }, runtime.signal);
      return { product: "shop", refreshed: true, saved: true, expiresAt };
    } catch (caught) {
      const error = safeError(caught);
      throw new CliError(error.code, "刷新未完成，旧会话可能已失效；请重新执行 login --product shop，不要自动重放刷新。", { retryable: false });
    }
  });
}
