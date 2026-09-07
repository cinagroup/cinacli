import { randomUUID } from "node:crypto";
import * as z from "zod";
import { loadProduct, parseUpstream } from "../../core/product.js";
import { requestJson } from "../../core/transport.js";
import { CliError } from "../../core/errors.js";
import type { Runtime } from "../../core/command.js";

type Input = { context?: string | undefined };
const quantity = z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/).max(66);
// Versioned metadata from cinachain/config/deployment.ts; other networks remain explicitly unknown.
const baseSepolia = { name: "Base Sepolia", testnet: true, nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 } };

async function rpc(endpoint: string, method: "eth_chainId" | "eth_blockNumber" | "eth_getBalance", params: string[], runtime: Runtime): Promise<string> {
  const id = randomUUID();
  const response = await requestJson(endpoint, {
    signal: runtime.signal, method: "POST", retryRead: true,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const parsed = parseUpstream(z.union([
    z.strictObject({ jsonrpc: z.literal("2.0"), id: z.literal(id), result: quantity }),
    z.strictObject({ jsonrpc: z.literal("2.0"), id: z.literal(id), error: z.object({ code: z.number().int(), message: z.string() }) }),
  ]), response);
  if ("error" in parsed) {
    if (parsed.error.code === -32601) throw new CliError("CAPABILITY_UNAVAILABLE", "RPC 不支持所需读取方法。");
    if (parsed.error.code === -32005) throw new CliError("RATE_LIMITED");
    // Provider text/data may contain credentials or arbitrary content; do not forward it.
    throw new CliError("UPSTREAM_RPC_ERROR");
  }
  return parsed.result.toLowerCase();
}

async function readState(input: Input, runtime: Runtime) {
  const target = await loadProduct(input, runtime, "chain");
  const expected = target.context.products.chain?.chainId;
  if (!expected) throw new CliError("CONFIG_INVALID", "请先配置预期 chain.chainId。");
  const actual = BigInt(await rpc(target.endpoint, "eth_chainId", [], runtime));
  if (actual !== BigInt(expected)) throw new CliError("PRECONDITION_FAILED", "RPC 返回的网络编号与配置不符。");
  const tag = await rpc(target.endpoint, "eth_blockNumber", [], runtime);
  const network = { chainId: actual.toString(), ...(actual === 84532n ? baseSepolia : { name: null, testnet: null, nativeCurrency: null }) };
  return { endpoint: target.endpoint, network, block: { number: BigInt(tag).toString(), tag } };
}

export async function chainStatus(input: Input, runtime: Runtime) {
  const { network, block } = await readState(input, runtime);
  return { network, block };
}

export async function chainBalance(input: Input & { address: string }, runtime: Runtime) {
  const { endpoint, network, block } = await readState(input, runtime);
  const value = BigInt(await rpc(endpoint, "eth_getBalance", [input.address.toLowerCase(), block.tag], runtime)).toString();
  let formatted: string | null = null;
  if (network.nativeCurrency) {
    const padded = value.padStart(network.nativeCurrency.decimals + 1, "0");
    const fraction = padded.slice(-network.nativeCurrency.decimals).replace(/0+$/, "");
    formatted = padded.slice(0, -network.nativeCurrency.decimals) + (fraction ? `.${fraction}` : "");
  }
  return { network, block, address: input.address.toLowerCase(), balance: { value, unit: "base-unit", formatted } };
}
