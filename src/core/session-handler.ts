import { CliError } from "./errors.js";
import { loadProduct } from "./product.js";
import { credentialBinding, credentialKey, saveCredential } from "./credentials/store.js";
import { readConfig, selectContext } from "./context/store.js";
import { readAccount, readWorkspaces } from "../products/token/handler.js";
import type { Runtime } from "./command.js";

type Selection = "gateway" | "management";
type Input = { context?: string | undefined; product: string; credential?: Selection | undefined };
const variables = { gateway: "CINA_TOKEN_GATEWAY_KEY", management: "CINA_TOKEN_MANAGEMENT_KEY" } as const;

export async function login(input: Input & { tokenStdin: boolean; secretStdin: boolean; noStore: boolean; noInput: boolean; vendor?: string | undefined }, runtime: Runtime) {
  if (input.product === "seek") return (await import("../products/seek/session.js")).loginSeek(input, runtime);
  if (input.vendor) throw new CliError("INVALID_ARGUMENT", "--vendor 仅适用于 Seek 浏览器登录。");
  if (input.product === "shop") return (await import("../products/shop/session.js")).loginShop(input, runtime);
  if (input.product !== "token") throw new CliError("CAPABILITY_UNAVAILABLE", "此产品的登录尚未接入；当前支持 Token 和 Shop。");
  if (input.secretStdin) throw new CliError("INVALID_ARGUMENT", "Token 密钥管道输入使用 --token-stdin。");
  const selection = input.credential;
  if (!selection) throw new CliError("INVALID_ARGUMENT", "Token 登录需要明确指定 --credential gateway 或 management。");
  const { context, endpoint } = await loadProduct(input, runtime, "token");
  const fromEnvironment = runtime.env[variables[selection]];
  if (input.tokenStdin && fromEnvironment !== undefined) throw new CliError("INVALID_ARGUMENT", "请只提供一种凭据来源：stdin 或对应环境变量。");
  if (input.tokenStdin && !runtime.readSecret) throw new CliError("CREDENTIAL_REQUIRED");
  const secret = input.tokenStdin ? await runtime.readSecret!(runtime.signal) : fromEnvironment;
  if (!secret || secret.length > 16_384 || /[\s\0]/.test(secret)) throw new CliError("CREDENTIAL_REQUIRED", "请通过对应凭据环境变量或 --token-stdin 提供有效密钥。");
  if (selection === "gateway") await readAccount(endpoint, secret, runtime, context);
  else await readWorkspaces(endpoint, secret, runtime, 0, 1);
  const binding = credentialBinding(context, `token-${selection}`);
  if (!input.noStore) {
    const current = selectContext(await readConfig(runtime.directory()), context.name, {});
    if (credentialKey(credentialBinding(current, binding.scheme)) !== credentialKey(binding)) throw new CliError("CONFLICT", "认证期间产品配置发生变化，请重试。");
    await saveCredential(runtime.store, { version: 1, binding, secret, principal: null, scopes: [], expiresAt: null }, runtime.signal);
  }
  return { product: "token", credential: selection, validated: true, saved: !input.noStore, source: input.tokenStdin ? "stdin" : "environment", expiresAt: null, principal: null };
}

export async function logout(input: Input, runtime: Runtime) {
  if (input.product === "seek") return (await import("../products/seek/session.js")).logoutSeek(input, runtime);
  if (input.product === "shop") return (await import("../products/shop/session.js")).logoutShop(input, runtime);
  if (input.product !== "token") throw new CliError("CAPABILITY_UNAVAILABLE", "此产品的退出登录尚未接入；当前可使用 --product token。");
  const { context } = await loadProduct(input, runtime, "token");
  const selected: Selection[] = input.credential ? [input.credential] : ["gateway", "management"];
  const removed = [];
  for (const credential of selected) {
    const binding = credentialBinding(context, `token-${credential}`);
    await runtime.store.remove(credentialKey(binding), runtime.signal);
    removed.push({ credential, localCleared: true });
  }
  return { product: "token", removed, remoteRevocation: "not-requested", environmentCredentialsPresent: selected.some(credential => runtime.env[variables[credential]] !== undefined) };
}
