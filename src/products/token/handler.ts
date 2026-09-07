import * as z from "zod";
import { apiUrl, decimalString, loadProduct, parseUpstream } from "../../core/product.js";
import { credentialBinding, resolveCredential } from "../../core/credentials/store.js";
import { requestJson } from "../../core/transport.js";
import { CliError } from "../../core/errors.js";
import type { Runtime } from "../../core/command.js";
import type { Context } from "../../core/context/schema.js";
import type { CredentialScheme } from "../../core/credentials/store.js";

type Input = { context?: string | undefined };
const id = z.string().min(1).max(512);
const money = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
const accountResponse = z.object({
  workspace_id: id, budget_max: money.nullable(), budget_spent: money,
  budget_period: z.string().min(1), budget_reset_at: z.iso.datetime({ offset: true }).nullable(), billing_currency: z.string().regex(/^[A-Z]{3}$/),
});
const modelResponse = z.object({
  id, object: z.literal("model"), owned_by: z.string(),
  model_info: z.object({
    display_name: z.string().nullable(), vendor: z.string(), tags: z.array(z.string()), route_groups: z.array(z.string()),
    context_window: z.number().int().nonnegative().safe().nullable(), max_tokens: z.number().int().nonnegative().safe().nullable(),
    input_modalities: z.array(z.string()).nullable(), output_modalities: z.array(z.string()).nullable(),
  }).optional(),
});
const workspacesResponse = z.object({
  data: z.array(z.object({ id, name: z.string(), slug: z.string(), description: z.string().nullable(), created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }) })),
  total_count: z.number().int().nonnegative().safe(),
});

async function tokenRequest(endpoint: string, path: string, secret: string, runtime: Runtime, query: Record<string, string | number | undefined> = {}) {
  return requestJson(apiUrl(endpoint, path, query), { signal: runtime.signal, retryRead: true, headers: { Authorization: `Bearer ${secret}` } });
}

async function access(input: Input, runtime: Runtime, scheme: CredentialScheme) {
  const target = await loadProduct(input, runtime, "token");
  const { credential } = await resolveCredential(runtime.store, credentialBinding(target.context, scheme), runtime.env, runtime.signal);
  return { ...target, secret: credential.secret };
}

export async function readAccount(endpoint: string, secret: string, runtime: Runtime, context: Context) {
  const account = parseUpstream(accountResponse, await tokenRequest(endpoint, "v1/me", secret, runtime));
  if (context.products.token?.workspaceId && account.workspace_id !== context.products.token.workspaceId) {
    throw new CliError("PRECONDITION_FAILED", "Gateway Key 的工作区与当前配置不符。");
  }
  return account;
}

export async function showAccount(input: Input, runtime: Runtime) {
  const target = await access(input, runtime, "token-gateway");
  const account = await readAccount(target.endpoint, target.secret, runtime, target.context);
  return {
    workspaceId: account.workspace_id,
    budget: { maximum: account.budget_max === null ? null : decimalString(account.budget_max), spent: decimalString(account.budget_spent), period: account.budget_period,
      resetAt: account.budget_reset_at === null ? null : new Date(account.budget_reset_at).toISOString(), currency: account.billing_currency },
  };
}

export async function listModels(input: Input & { kind?: string | undefined; routeGroups?: string | undefined }, runtime: Runtime) {
  const target = await access(input, runtime, "token-gateway");
  if (target.context.products.token?.workspaceId) await readAccount(target.endpoint, target.secret, runtime, target.context);
  const response = parseUpstream(z.object({ object: z.literal("list"), data: z.array(modelResponse) }), await tokenRequest(target.endpoint, "v1/models", target.secret, runtime, { kind: input.kind, route_groups: input.routeGroups }));
  runtime.meta.pagination = { mode: "none" };
  return { items: response.data.map(model => ({ id: model.id, ownedBy: model.owned_by, info: model.model_info ? {
    displayName: model.model_info.display_name, vendor: model.model_info.vendor, tags: model.model_info.tags,
    routeGroups: model.model_info.route_groups, contextWindow: model.model_info.context_window, maxTokens: model.model_info.max_tokens,
    inputModalities: model.model_info.input_modalities, outputModalities: model.model_info.output_modalities,
  } : null })) };
}

export async function readWorkspaces(endpoint: string, secret: string, runtime: Runtime, offset: number, limit: number) {
  const response = parseUpstream(workspacesResponse, await tokenRequest(endpoint, "api/v1/workspaces", secret, runtime, { offset, limit }));
  if (response.data.length > limit || response.data.length > response.total_count) throw new CliError("UPSTREAM_CONTRACT_MISMATCH");
  return response;
}

export async function listWorkspaces(input: Input & { offset: number; limit: number }, runtime: Runtime) {
  const target = await access(input, runtime, "token-management");
  const response = await readWorkspaces(target.endpoint, target.secret, runtime, input.offset, input.limit);
  const hasMore = input.offset + response.data.length < response.total_count;
  runtime.meta.pagination = { mode: "offset", offset: input.offset, limit: input.limit, total: response.total_count, hasMore,
    nextOffset: hasMore && response.data.length > 0 ? input.offset + response.data.length : null };
  return { items: response.data.map(item => ({ id: item.id, name: item.name, slug: item.slug, description: item.description, createdAt: new Date(item.created_at).toISOString(), updatedAt: new Date(item.updated_at).toISOString() })) };
}
