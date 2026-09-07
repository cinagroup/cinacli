import * as z from "zod";
import { define } from "../../core/command.js";

export const decimal = z.string().regex(/^\d+(?:\.\d+)?$/).max(128);
export const productSchema = z.strictObject({ id: z.string(), name: z.string(), image: z.string(), price: decimal, currency: z.null(), stock: z.number().int().nonnegative().safe() });
export const orderSchema = z.strictObject({
  id: z.string(), orderId: z.string(), status: z.number().int().safe(), statusName: z.string(), paid: z.boolean(),
  totalQuantity: z.number().int().nonnegative().safe(), totalPrice: decimal, payPrice: decimal, currency: z.null(),
  createdAt: z.iso.datetime().nullable(), paidAt: z.iso.datetime().nullable(),
});
const pagination = { page: z.number().int().min(1).max(100_000).default(1), limit: z.number().int().min(1).max(100).default(20) };
const pagingFlags = { page: { type: "number", field: "page" }, limit: { type: "number", field: "limit" } } as const;
const read = (permission: string) => ({ effect: "business-read" as const, retryPolicy: "idempotent-read" as const, contextRequirements: ["selected context", "shop.endpoint"], authentication: [{ scheme: "shop-out", scopes: [], permissions: [permission] }] });

export const shopCommands = [
  define({
    id: "shop.products.list", summary: "列出开放接口可见的在售商品", ...read("GET /product/list"), pagination: "page",
    shape: { ...pagination, name: z.string().min(1).max(100).optional() }, flags: { ...pagingFlags, name: { type: "string", field: "name" } },
    output: z.strictObject({ items: z.array(productSchema) }),
    run: async (input, runtime) => (await import("./handler.js")).listProducts(input, runtime),
  }),
  define({
    id: "shop.products.get", summary: "读取平台商品详情摘要", ...read("GET /product/{id}"),
    shape: { id: z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value))) }, positionals: ["id"], output: productSchema,
    run: async (input, runtime) => (await import("./handler.js")).getProduct(input, runtime),
  }),
  define({
    id: "shop.orders.list", summary: "列出开放接口账号可读的订单摘要", ...read("GET /order/list"), pagination: "page",
    shape: { ...pagination, status: z.number().int().safe().optional(), paid: z.enum(["0", "1"]).optional() },
    flags: { ...pagingFlags, status: { type: "number", field: "status" }, paid: { type: "string", field: "paid" } }, output: z.strictObject({ items: z.array(orderSchema) }),
    run: async (input, runtime) => (await import("./handler.js")).listOrders(input, runtime),
  }),
  define({
    id: "shop.orders.get", summary: "按订单号读取订单详情摘要", ...read("GET /order/{order_id}"),
    shape: { orderId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }, positionals: ["orderId"], output: orderSchema,
    run: async (input, runtime) => (await import("./handler.js")).getOrder(input, runtime),
  }),
  define({
    id: "shop.session.refresh", summary: "显式刷新当前已保存的开放接口会话", effect: "auth-state",
    contextRequirements: ["selected context", "shop.endpoint", "saved shop-out credential"],
    authentication: [{ scheme: "shop-out", scopes: [], permissions: ["Valid Out API session"] }], shape: {},
    output: z.strictObject({ product: z.literal("shop"), refreshed: z.literal(true), saved: z.literal(true), expiresAt: z.iso.datetime() }),
    run: async (input, runtime) => (await import("./session.js")).refreshShop(input, runtime),
  }),
];
