import * as z from "zod";
import { CliError, errorDefinitions } from "./errors.js";
import { configKeys, contextNameSchema, productSchema, products, publicContext, publicContextSchema, productEndpoint } from "./context/schema.js";
import { createContext, readConfig, selectContext, setConfigValue, updateConfig } from "./context/store.js";
import { probeSecretStore } from "./credentials/store.js";
import { probeEndpoint } from "./transport.js";
import type { Environment } from "./context/store.js";
import type { SecretStore } from "./credentials/store.js";

export interface Runtime {
  env: Environment;
  directory: () => string;
  signal: AbortSignal;
  store: SecretStore;
  version: string;
  context: { name: string; product: string | null } | null;
}

export const globalShape = {
  context: contextNameSchema.optional().describe("命名环境；优先于 CINA_CONTEXT"),
  json: z.boolean().default(false).describe("stdout 输出单个 JSON 文档"),
  noInput: z.boolean().default(false).describe("禁止交互和隐式登录"),
  timeout: z.number().positive().max(300).default(30).describe("总超时，单位秒，最多 300 秒"),
};
export const globalFlags = {
  context: { type: "string", field: "context" },
  json: { type: "boolean", field: "json" },
  "no-input": { type: "boolean", field: "noInput" },
  timeout: { type: "number", field: "timeout" },
} as const;
export interface Flag { type: "string" | "boolean" | "number"; field: string }
export interface Command {
  id: string;
  path: string[];
  summary: string;
  effect: "local-read" | "local-write";
  contextRequirements: string[];
  positionals: string[];
  flags: Record<string, Flag>;
  input: z.ZodType;
  output: z.ZodType;
  run: (input: unknown, runtime: Runtime) => Promise<unknown>;
}

function define<Shape extends z.ZodRawShape>(spec: {
  id: string; summary: string; effect?: Command["effect"]; contextRequirements?: string[];
  shape: Shape; output: z.ZodType; positionals?: string[]; flags?: Record<string, Flag>;
  run: (input: z.infer<z.ZodObject<Shape & typeof globalShape>>, runtime: Runtime) => Promise<unknown>;
}): Command {
  const input = z.strictObject({ ...globalShape, ...spec.shape });
  return {
    id: spec.id, path: spec.id.split("."), summary: spec.summary,
    effect: spec.effect ?? "local-read", contextRequirements: spec.contextRequirements ?? [],
    positionals: spec.positionals ?? [], flags: { ...globalFlags, ...spec.flags }, input, output: spec.output,
    run: async (raw, runtime) => {
      const parsed = input.safeParse(raw);
      if (!parsed.success) throw new CliError("INVALID_ARGUMENT");
      const result = await spec.run(parsed.data, runtime);
      const output = spec.output.safeParse(result);
      if (!output.success) throw new CliError("INTERNAL_ERROR");
      return output.data;
    },
  };
}

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
        adapter: z.literal("not-implemented"),
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
        checks.push({ product, configuration: endpoint ? "configured" : "not-configured", connectivity, adapter: "not-implemented", authorization: "unknown" });
      }
      // M0 has no product adapters; a reachable socket does not imply a ready product.
      return { status: "attention", credentialStore: available ? "available" : "unavailable", checks };
    },
  }),
];

export function commandRegistry(): readonly Command[] { return commands; }

export function commandSchema(command: Command): Record<string, unknown> {
  return {
    command: command.id, summary: command.summary,
    inputSchema: z.toJSONSchema(command.input, { io: "input" }),
    outputSchema: z.toJSONSchema(command.output),
    arguments: command.positionals,
    flags: command.flags,
    authentication: [], contextRequirements: command.contextRequirements, effect: command.effect,
    pagination: "none", streaming: false,
    retryPolicy: "none", idempotency: "none", preview: "none",
  };
}
