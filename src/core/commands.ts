import * as z from "zod";
import { CliError, errorDefinitions } from "./errors.js";
import { configKeys, contextNameSchema, productSchema, products, publicContext, publicContextSchema, productEndpoint } from "./context/schema.js";
import { createContext, readConfig, selectContext, setConfigValue, updateConfig } from "./context/store.js";
import { probeSecretStore } from "./credentials/store.js";
import { probeEndpoint } from "./transport.js";
import { define } from "./command.js";
import type { Command, Runtime } from "./command.js";
import { tokenCommands } from "../products/token/commands.js";
import { chainCommands } from "../products/chain/commands.js";
import { sessionCommands } from "./sessions.js";
import { authCommands } from "../products/auth/commands.js";
import { shopCommands } from "../products/shop/commands.js";
import { seekCommands } from "../products/seek/commands.js";
export { globalShape, globalFlags } from "./command.js";
export type { Command, Flag, Runtime } from "./command.js";

const contextResult = z.strictObject({ context: publicContextSchema });
const contextOptions = { contextRequirements: ["selected context"] };

async function loadContext(input: { context?: string | undefined }, runtime: Runtime) {
  const context = selectContext(await readConfig(runtime.directory()), input.context, runtime.env);
  runtime.context = { name: context.name, product: null };
  return context;
}

const commands: Command[] = [
  define({
    id: "context.create", summary: "创建空环境；不自动选择为当前环境", effect: "local-write",
    shape: { name: contextNameSchema }, positionals: ["name"], output: contextResult,
    run: async ({ name }, runtime) => ({ context: publicContext(await updateConfig(runtime.directory(), (config) => createContext(config, name))) }),
  }),
  define({
    id: "context.list", summary: "列出本地环境", shape: {},
    output: z.strictObject({ current: contextNameSchema.nullable(), selected: contextNameSchema.nullable(), items: z.array(publicContextSchema) }),
    run: async (input, runtime) => {
      const config = await readConfig(runtime.directory());
      const hasSelection = input.context !== undefined || runtime.env.CINA_CONTEXT !== undefined || config.current !== null;
      const selected = hasSelection ? selectContext(config, input.context, runtime.env).name : null;
      return { current: config.current, selected, items: config.contexts.map(publicContext) };
    },
  }),
  define({
    id: "context.show", summary: "查看所选环境", ...contextOptions,
    shape: {}, output: contextResult,
    run: async (input, runtime) => ({ context: publicContext(await loadContext(input, runtime)) }),
  }),
  define({
    id: "context.use", summary: "选择已存在的环境", effect: "local-write",
    shape: { name: contextNameSchema }, positionals: ["name"], output: contextResult,
    run: async ({ name }, runtime) => {
      const context = await updateConfig(runtime.directory(), (config) => {
        const selected = selectContext(config, name, {});
        config.current = name;
        return selected;
      });
      runtime.context = { name, product: null };
      return { context: publicContext(context) };
    },
  }),
  define({
    id: "config.show", summary: "查看所选环境的非敏感配置", ...contextOptions,
    shape: {}, output: contextResult,
    run: async (input, runtime) => ({ context: publicContext(await loadContext(input, runtime)) }),
  }),
  define({
    id: "config.set", summary: "修改允许的非敏感配置字段", effect: "local-write", ...contextOptions,
    shape: { key: z.enum(configKeys), value: z.string().min(1).max(2048) },
    positionals: ["key", "value"], output: contextResult,
    run: async (input, runtime) => {
      const context = await updateConfig(runtime.directory(), (config) => {
        const selected = selectContext(config, input.context, runtime.env);
        runtime.context = { name: selected.name, product: null };
        setConfigValue(selected, input.key, input.value);
        return selected;
      });
      return { context: publicContext(context) };
    },
  }),
  define({
    id: "schema", summary: "离线查看已实现命令及 JSON Schema",
    shape: { commandId: z.string().regex(/^[a-z]+(?:\.[a-z]+)*$/).optional() }, positionals: ["commandId"],
    output: z.strictObject({ schemaVersion: z.literal("1"), commands: z.array(z.record(z.string(), z.unknown())), errors: z.record(z.string(), z.unknown()) }),
    run: async (input) => {
      const selected = input.commandId ? commands.filter((item) => item.id === input.commandId) : commands;
      if (!selected.length) throw new CliError("CAPABILITY_UNAVAILABLE", "命令未实现或不存在；请使用 cina schema 查看可用命令。");
      return { schemaVersion: "1", commands: selected.map(commandSchema), errors: Object.fromEntries(Object.entries(errorDefinitions).map(([code, [exitCode, message, retryable]]) => [code, { exitCode, message, retryable }])) };
    },
  }),
  define({
    id: "doctor", summary: "检查本地配置；可选择 TCP/TLS 连通性检查",
    shape: { product: productSchema.optional(), network: z.boolean().default(false) },
    flags: { product: { type: "string", field: "product" }, network: { type: "boolean", field: "network" } },
    output: z.strictObject({
      status: z.enum(["ready", "attention"]),
      credentialStore: z.enum(["available", "unavailable"]),
      checks: z.array(z.strictObject({
        product: productSchema,
        configuration: z.enum(["configured", "not-configured"]),
        connectivity: z.enum(["not-checked", "reachable", "failed"]),
        adapter: z.enum(["implemented", "not-implemented"]),
        authorization: z.literal("unknown"),
      })),
    }),
    run: async (input, runtime) => {
      const config = await readConfig(runtime.directory());
      const configuredSelection = input.context !== undefined || runtime.env.CINA_CONTEXT !== undefined || config.current !== null;
      const context = configuredSelection ? selectContext(config, input.context, runtime.env) : null;
      if (context) runtime.context = { name: context.name, product: input.product ?? null };
      const selectedProducts = input.product ? [input.product] : products;
      const available = await probeSecretStore(runtime.store, runtime.signal);
      const checks = [];
      for (const product of selectedProducts) {
        runtime.signal.throwIfAborted();
        const endpoint = context ? productEndpoint(context, product) : undefined;
        let connectivity: "not-checked" | "reachable" | "failed" = "not-checked";
        if (input.network && endpoint) {
          try { await probeEndpoint(endpoint, runtime.signal); connectivity = "reachable"; }
          catch { if (runtime.signal.aborted) throw runtime.signal.reason; connectivity = "failed"; }
        }
        checks.push({ product, configuration: endpoint ? "configured" : "not-configured", connectivity, adapter: commands.some((command) => command.id.startsWith(`${product}.`)) ? "implemented" : "not-implemented", authorization: "unknown" });
      }
      // Connectivity alone never proves authorization or application readiness.
      return { status: "attention", credentialStore: available ? "available" : "unavailable", checks };
    },
  }),
  ...tokenCommands,
  ...chainCommands,
  ...sessionCommands,
  ...authCommands,
  ...shopCommands,
  ...seekCommands,
];

export function commandRegistry(): readonly Command[] { return commands; }

export function commandSchema(command: Command): Record<string, unknown> {
  return {
    command: command.id, summary: command.summary,
    inputSchema: z.toJSONSchema(command.input, { io: "input" }),
    outputSchema: z.toJSONSchema(command.output),
    arguments: command.positionals,
    flags: command.flags,
    authentication: command.authentication, contextRequirements: command.contextRequirements, effect: command.effect,
    pagination: command.pagination, streaming: false,
    retryPolicy: command.retryPolicy, idempotency: "none", preview: "none",
  };
}
