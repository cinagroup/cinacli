import * as z from "zod";
import { define } from "../../core/command.js";

export const modelSchema = z.strictObject({
  id: z.string(), ownedBy: z.string(),
  info: z.strictObject({
    displayName: z.string().nullable(), vendor: z.string(), tags: z.array(z.string()),
    routeGroups: z.array(z.string()), contextWindow: z.number().int().nonnegative().safe().nullable(),
    maxTokens: z.number().int().nonnegative().safe().nullable(),
    inputModalities: z.array(z.string()).nullable(), outputModalities: z.array(z.string()).nullable(),
  }).nullable(),
});
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
export const accountSchema = z.strictObject({
  workspaceId: z.string(),
  budget: z.strictObject({
    maximum: decimal.nullable(), spent: decimal,
    period: z.string(), resetAt: z.iso.datetime().nullable(), currency: z.string().regex(/^[A-Z]{3}$/),
  }),
});
export const workspaceSchema = z.strictObject({
  id: z.string(), name: z.string(), slug: z.string(), description: z.string().nullable(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
const common = { effect: "business-read", contextRequirements: ["selected context", "token.endpoint"], retryPolicy: "idempotent-read" } as const;
const gateway = [{ scheme: "token-gateway", scopes: [], permissions: ["Gateway API key"] }];
const management = [{ scheme: "token-management", scopes: [], permissions: ["Management API key account scope"] }];

export const tokenCommands = [
  define({
    id: "token.models.list", summary: "列出当前 Gateway Key 可发现的模型", ...common, authentication: gateway,
    shape: {
      kind: z.enum(["llm", "image", "audio", "embedding", "all"]).optional().describe("省略时保留服务端 LLM 默认筛选"),
      routeGroups: z.string().regex(/^[a-zA-Z0-9_-]+(?:,[a-zA-Z0-9_-]+)*$/).max(512).optional().describe("CSV；省略时保留服务端 default,free 默认值"),
    },
    flags: { kind: { type: "string", field: "kind" }, "route-groups": { type: "string", field: "routeGroups" } },
    output: z.strictObject({ items: z.array(modelSchema) }),
    run: async (input, runtime) => (await import("./handler.js")).listModels(input, runtime),
  }),
  define({
    id: "token.account.show", summary: "查看当前 Gateway Key 的工作区和预算", ...common, authentication: gateway,
    shape: {}, output: accountSchema,
    run: async (input, runtime) => (await import("./handler.js")).showAccount(input, runtime),
  }),
  define({
    id: "token.workspaces.list", summary: "列出 Management Key 账号可访问的工作区", ...common, authentication: management, pagination: "offset",
    shape: { offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(50) },
    flags: { offset: { type: "number", field: "offset" }, limit: { type: "number", field: "limit" } },
    output: z.strictObject({ items: z.array(workspaceSchema) }),
    run: async (input, runtime) => (await import("./handler.js")).listWorkspaces(input, runtime),
  }),
];
