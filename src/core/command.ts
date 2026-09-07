import * as z from "zod";
import { CliError } from "./errors.js";
import { contextNameSchema } from "./context/schema.js";
import type { Environment } from "./context/store.js";
import type { SecretStore } from "./credentials/store.js";

export interface Runtime {
  env: Environment;
  directory: () => string;
  signal: AbortSignal;
  store: SecretStore;
  version: string;
  context: { name: string; product: string | null } | null;
  meta: Record<string, unknown>;
  readSecret?: ((signal: AbortSignal) => Promise<string>) | undefined;
  openBrowser?: ((url: string, signal: AbortSignal) => Promise<void>) | undefined;
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
export interface Authentication { scheme: string; scopes: string[]; permissions: string[] }
export interface Command {
  defaultTimeoutSeconds: number;
  id: string;
  path: string[];
  summary: string;
  effect: "local-read" | "local-write" | "business-read" | "auth-state";
  authentication: Authentication[];
  pagination: "none" | "offset" | "page";
  retryPolicy: "none" | "idempotent-read";
  contextRequirements: readonly string[];
  positionals: string[];
  flags: Record<string, Flag>;
  input: z.ZodType;
  output: z.ZodType;
  run: (input: unknown, runtime: Runtime) => Promise<unknown>;
}

export function define<Shape extends z.ZodRawShape>(spec: {
  defaultTimeoutSeconds?: number;
  id: string; summary: string; effect?: Command["effect"]; contextRequirements?: readonly string[];
  authentication?: Authentication[]; pagination?: Command["pagination"]; retryPolicy?: Command["retryPolicy"];
  shape: Shape; output: z.ZodType; positionals?: string[]; flags?: Record<string, Flag>;
  run: (input: z.infer<z.ZodObject<Shape & typeof globalShape>>, runtime: Runtime) => Promise<unknown>;
}): Command {
  const defaultTimeoutSeconds = spec.defaultTimeoutSeconds ?? 30;
  const selectedGlobals: typeof globalShape = { ...globalShape, timeout: globalShape.timeout.unwrap().default(defaultTimeoutSeconds) };
  const input = z.strictObject({ ...selectedGlobals, ...spec.shape });
  return {
    id: spec.id, path: spec.id.split("."), summary: spec.summary, defaultTimeoutSeconds,
    effect: spec.effect ?? "local-read", contextRequirements: spec.contextRequirements ?? [],
    authentication: spec.authentication ?? [], pagination: spec.pagination ?? "none", retryPolicy: spec.retryPolicy ?? "none",
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
