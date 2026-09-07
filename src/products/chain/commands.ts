import * as z from "zod";
import { define } from "../../core/command.js";

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("20 字节 EVM 地址；不是私钥，首版不解析 ENS");
export const networkSchema = z.strictObject({
  chainId: z.string().regex(/^\d+$/), name: z.string().nullable(), testnet: z.boolean().nullable(),
  nativeCurrency: z.strictObject({ name: z.string(), symbol: z.string(), decimals: z.number().int() }).nullable(),
});
export const blockSchema = z.strictObject({ number: z.string().regex(/^\d+$/), tag: z.string().regex(/^0x[0-9a-f]+$/) });
const common = { effect: "business-read", contextRequirements: ["selected context", "chain.endpoint", "chain.chainId"], retryPolicy: "idempotent-read" } as const;
export const chainCommands = [
  define({
    id: "chain.status", summary: "核对 RPC 网络并查询当前区块", ...common,
    shape: {}, output: z.strictObject({ network: networkSchema, block: blockSchema }),
    run: async (input, runtime) => (await import("./handler.js")).chainStatus(input, runtime),
  }),
  define({
    id: "chain.balance", summary: "查询指定地址在明确区块的原生币余额", ...common,
    shape: { address: addressSchema }, flags: { address: { type: "string", field: "address" } },
    output: z.strictObject({ network: networkSchema, block: blockSchema, address: addressSchema,
      balance: z.strictObject({ value: z.string().regex(/^\d+$/), unit: z.literal("base-unit"), formatted: z.string().nullable() }) }),
    run: async (input, runtime) => (await import("./handler.js")).chainBalance(input, runtime),
  }),
];
