import * as z from "zod";
import { loadProduct, apiUrl, parseUpstream } from "../../core/product.js";
import { requestJson } from "../../core/transport.js";
import { credentialBinding, resolveCredential } from "../../core/credentials/store.js";
import { CliError } from "../../core/errors.js";
import { decimal } from "./commands.js";
import type { Runtime } from "../../core/command.js";
import type { Credential } from "../../core/credentials/store.js";
import type { Context } from "../../core/context/schema.js";
import type { JsonRequest } from "../../core/transport.js";

type Input = { context?: string | undefined };
const natural = z.number().int().nonnegative().safe();
const identity = z.number().int().positive().safe();
const timestamp = natural.max(253_402_300_799);
const product = z.object({ id: identity, store_name: z.string(), image: z.string(), price: decimal, stock: natural });
const order = z.object({ id: identity, order_id: z.string().min(1), status: z.number().int().safe(), status_name: z.string(), paid: z.union([z.literal(0), z.literal(1)]),
  total_num: natural, total_price: decimal, pay_price: decimal, add_time: timestamp, pay_time: timestamp });

/** HTTP success is not the legacy Shop business success signal. Never forward msg/data on errors. */
export async function shopRequest(endpoint: string, path: string, runtime: Runtime, options: Omit<JsonRequest, "signal"> = {}, query: Record<string, string | number | undefined> = {}): Promise<unknown> {
  const response = parseUpstream(z.object({ status: z.number().int(), data: z.unknown().optional() }), await requestJson(apiUrl(endpoint, `/outapi/${path}`, query), { ...options, signal: runtime.signal }));
  if (response.status === 200) return response.data;
  // The current server also uses 410000 for some permission failures; do not guess from localized msg.
  if ([401, 410000].includes(response.status)) throw new CliError("AUTHENTICATION_FAILED", "开放接口认证未通过；请核对会话、账号状态和接口授权。");
  if (response.status === 410001) throw new CliError("TOKEN_EXPIRED");
  if ([403, 400011, 410002].includes(response.status)) throw new CliError("PERMISSION_DENIED");
  if (response.status === 404) throw new CliError("RESOURCE_NOT_FOUND");
  if (response.status === 409) throw new CliError("CONFLICT");
  if (response.status === 429) throw new CliError("RATE_LIMITED");
  if (response.status === 501) throw new CliError("CAPABILITY_UNAVAILABLE");
  if (response.status >= 500 && response.status <= 599) throw new CliError("UPSTREAM_UNAVAILABLE");
  if (response.status === 400) throw new CliError("PRECONDITION_FAILED", "开放接口拒绝请求；请核对参数、账号状态及认证信息。");
  throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
}

export function assertAccount(context: Context, credential: Credential) {
  const expected = context.products.shop?.accountId;
  if (expected && credential.principal !== expected) throw new CliError("PRECONDITION_FAILED", "无法确认开放接口账号归属；请使用匹配账号重新登录。环境变量 token 没有已验证的账号元数据。");
}

async function access(input: Input, runtime: Runtime) {
  const target = await loadProduct(input, runtime, "shop");
  const { credential } = await resolveCredential(runtime.store, credentialBinding(target.context, "shop-out"), runtime.env, runtime.signal);
  assertAccount(target.context, credential);
  return { ...target, options: { headers: { Authorization: `Bearer ${credential.secret}` }, retryRead: true } };
}

function mapProduct(value: z.infer<typeof product>) {
  return { id: String(value.id), name: value.store_name, image: value.image, price: value.price, currency: null, stock: value.stock };
}
function mapOrder(value: z.infer<typeof order>) {
  return { id: String(value.id), orderId: value.order_id, status: value.status, statusName: value.status_name, paid: value.paid === 1,
    totalQuantity: value.total_num, totalPrice: value.total_price, payPrice: value.pay_price, currency: null,
    createdAt: value.add_time === 0 ? null : new Date(value.add_time * 1000).toISOString(), paidAt: value.pay_time === 0 ? null : new Date(value.pay_time * 1000).toISOString() };
}

function page<T extends z.ZodType>(schema: T, data: unknown, input: { page: number; limit: number }, runtime: Runtime) {
  const parsed = parseUpstream(z.object({ list: z.array(schema).max(input.limit), count: natural.nullable() }), data);
  if (parsed.count !== null && parsed.list.length > parsed.count) throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
  const hasMore = parsed.count === null ? null : parsed.list.length > 0 && (input.page - 1) * input.limit + parsed.list.length < parsed.count;
  runtime.meta.pagination = { mode: "page", page: input.page, limit: input.limit, total: parsed.count, hasMore, nextPage: hasMore && input.page < 100_000 ? input.page + 1 : null };
  return parsed.list;
}

export async function listProducts(input: Input & { page: number; limit: number; name?: string | undefined }, runtime: Runtime) {
  const target = await access(input, runtime);
  const data = await shopRequest(target.endpoint, "product/list", runtime, target.options, { page: input.page, limit: input.limit, store_name: input.name });
  return { items: page(product, data, input, runtime).map(mapProduct) };
}
export async function getProduct(input: Input & { id: string }, runtime: Runtime) {
  const target = await access(input, runtime);
  const value = parseUpstream(product, await shopRequest(target.endpoint, `product/${encodeURIComponent(input.id)}`, runtime, target.options));
  if (String(value.id) !== input.id) throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
  return mapProduct(value);
}
export async function listOrders(input: Input & { page: number; limit: number; status?: number | undefined; paid?: string | undefined }, runtime: Runtime) {
  const target = await access(input, runtime);
  const data = await shopRequest(target.endpoint, "order/list", runtime, target.options, { page: input.page, limit: input.limit, status: input.status, paid: input.paid });
  return { items: page(order, data, input, runtime).map(mapOrder) };
}
export async function getOrder(input: Input & { orderId: string }, runtime: Runtime) {
  const target = await access(input, runtime);
  const value = parseUpstream(order, await shopRequest(target.endpoint, `order/${encodeURIComponent(input.orderId)}`, runtime, target.options));
  if (value.order_id !== input.orderId) throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
  return mapOrder(value);
}
