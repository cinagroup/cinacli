import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { CliError, hasErrorCode } from "../errors.js";
import { configSchema, contextNameSchema, fieldSchemas, normalizeEndpoint } from "./schema.js";
import type { Config, ConfigKey, Context, Product } from "./schema.js";

export type Environment = Readonly<Record<string, string | undefined>>;

export function configDirectory(env: Environment, platform = process.platform): string {
  if (env.CINA_CONFIG_DIR !== undefined) {
    if (!isAbsolute(env.CINA_CONFIG_DIR)) throw new CliError("CONFIG_INVALID", "CINA_CONFIG_DIR 必须为绝对路径。");
    return env.CINA_CONFIG_DIR;
  }
  const root = platform === "win32" ? (env.APPDATA || join(homedir(), "AppData", "Roaming"))
    : platform === "darwin" ? join(homedir(), "Library", "Application Support")
    : (env.XDG_CONFIG_HOME || join(homedir(), ".config"));
  if (!isAbsolute(root)) throw new CliError("CONFIG_INVALID");
  return join(root, "cinacli");
}

/** Version 1 has strict validation. Future versions must add an explicit migration. */
export async function readConfig(directory: string): Promise<Config> {
  try {
    const text = await readFile(join(directory, "config.json"), "utf8");
    if (Buffer.byteLength(text) > 1_048_576) throw new CliError("CONFIG_INVALID");
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new CliError("CONFIG_INVALID"); }
    const parsed = configSchema.safeParse(value);
    if (!parsed.success) throw new CliError("CONFIG_INVALID");
    return parsed.data;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return { version: 1, current: null, contexts: [] };
    if (error instanceof CliError) throw error;
    throw new CliError("CONFIG_IO_ERROR");
  }
}

/** Fail on contention instead of overwriting another process's changes. No stale-lock stealing. */
export async function updateConfig<T>(directory: string, mutate: (config: Config) => T): Promise<T> {
  const lockPath = join(directory, "config.lock");
  const tempPath = join(directory, `config.${randomUUID()}.tmp`);
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    lock = await open(lockPath, "wx", 0o600);
    const config = await readConfig(directory);
    const result = mutate(config);
    if (!configSchema.safeParse(config).success) throw new CliError("CONFIG_INVALID");
    const file = await open(tempPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8");
      await file.sync();
    } finally { await file.close(); }
    await rename(tempPath, join(directory, "config.json"));
    return result;
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (hasErrorCode(error, "EEXIST")) throw new CliError("CONFLICT", "配置正被另一进程使用；若进程异常退出，请确认后移除 config.lock。");
    throw new CliError("CONFIG_IO_ERROR");
  } finally {
    await unlink(tempPath).catch(() => {});
    if (lock) {
      await lock.close();
      await unlink(lockPath).catch(() => {});
    }
  }
}

export function selectContext(config: Config, explicit: string | undefined, env: Environment): Context {
  const name = explicit ?? env.CINA_CONTEXT ?? config.current;
  if (!contextNameSchema.safeParse(name).success) throw new CliError("CONTEXT_NOT_FOUND");
  const context = config.contexts.find((item) => item.name === name);
  if (!context) throw new CliError("CONTEXT_NOT_FOUND");
  return context;
}

export function createContext(config: Config, name: string): Context {
  if (!contextNameSchema.safeParse(name).success) throw new CliError("INVALID_ARGUMENT");
  if (config.contexts.some((item) => item.name === name)) throw new CliError("CONFLICT");
  const context: Context = { id: randomUUID(), name, products: {}, credentialEpochs: {} };
  config.contexts.push(context);
  return context;
}

export function setConfigValue(context: Context, key: ConfigKey, raw: string): void {
  const [product, field] = key.split(".") as [Product, string];
  let value: string | number = raw;
  try {
    if (key === "chain.chainId") {
      if (!/^[1-9]\d*$/.test(raw)) throw new Error("Invalid integer");
      value = Number(raw);
    } else if (["issuer", "apiBase", "endpoint"].includes(field)) value = normalizeEndpoint(raw, product);
    if (!fieldSchemas[key].safeParse(value).success) throw new Error("Invalid value");
  } catch { throw new CliError("INVALID_ARGUMENT", "配置值无效；端点需要 HTTPS（本机允许 HTTP），且不能包含用户名、查询参数或片段。"); }
  const previous = context.products[product] ?? {};
  if (Reflect.get(previous, field) === value) return;
  // Bump on any product context change, including a change away and back to the same endpoint.
  context.products = { ...context.products, [product]: { ...previous, [field]: value } };
  context.credentialEpochs[product] = (context.credentialEpochs[product] ?? 0) + 1;
}
