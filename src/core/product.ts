import * as z from "zod";
import { readConfig, selectContext } from "./context/store.js";
import { productEndpoint } from "./context/schema.js";
import type { Product } from "./context/schema.js";
import type { Runtime } from "./command.js";
import { CliError } from "./errors.js";

export async function loadProduct(input: { context?: string | undefined }, runtime: Runtime, product: Product) {
  const context = selectContext(await readConfig(runtime.directory()), input.context, runtime.env);
  runtime.context = { name: context.name, product };
  const endpoint = productEndpoint(context, product);
  if (!endpoint) throw new CliError("CONFIG_INVALID", "请先配置所选产品的端点。");
  return { context, endpoint };
}

/** Paths are adapter-owned and append to the configured base path. */
export function apiUrl(base: string, path: string, query: Record<string, string | number | undefined> = {}): string {
  const url = new URL(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, String(value));
  return url.href;
}

export function parseUpstream<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
  return parsed.data;
}

/** Preserve the upstream JSON number's printable value without inventing decimal precision. */
export function decimalString(value: number): string {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [coefficient = "", exponent = "0"] = text.toLowerCase().split("e");
  const [integer = "", fraction = ""] = coefficient.split(".");
  const digits = integer + fraction;
  const position = integer.length + Number(exponent);
  if (position <= 0) return `0.${"0".repeat(-position)}${digits}`;
  if (position >= digits.length) return digits + "0".repeat(position - digits.length);
  return `${digits.slice(0, position)}.${digits.slice(position)}`;
}
