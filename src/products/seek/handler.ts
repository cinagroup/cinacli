import * as z from "zod";
import { credentialBinding, resolveCredential } from "../../core/credentials/store.js";
import { loadProduct, parseUpstream, decimalString } from "../../core/product.js";
import { withSeek } from "./transport.js";
import { serverConfig, user, workspace } from "./protocol.js";
import type { Runtime } from "../../core/command.js";

type Input = { context?: string | undefined };

export async function seekStatus(input: Input, runtime: Runtime) {
  const target = await loadProduct(input, runtime, "seek");
  return withSeek(target.endpoint, runtime, async api => {
    using result = await api.getServerConfig();
    const data = parseUpstream(serverConfig, result);
    return { vendors: data.authVendors.map(value => ({ id: value.vendorId, name: value.displayName })), passwordAuthEnabled: data.passwordAuthEnabled,
      clientProtocol: "capnweb/0.12.0", serverVersion: null, accessAuthentication: "not-supported" };
  });
}

async function access(input: Input, runtime: Runtime) {
  const target = await loadProduct(input, runtime, "seek");
  const { credential } = await resolveCredential(runtime.store, credentialBinding(target.context, "seek-session"), runtime.env, runtime.signal);
  return { ...target, credential };
}

export async function seekWhoami(input: Input, runtime: Runtime) {
  const target = await access(input, runtime);
  return withSeek(target.endpoint, runtime, async api => {
    using authenticated = await api.authenticate(target.credential.secret);
    using result = await authenticated.whoami();
    return parseUpstream(user, result);
  });
}

export async function listWorkspaces(input: Input, runtime: Runtime) {
  const target = await access(input, runtime);
  return withSeek(target.endpoint, runtime, async api => {
    using authenticated = await api.authenticate(target.credential.secret);
    using result = await authenticated.listGadgets();
    const data = parseUpstream(z.array(workspace).max(10_000), result);
    runtime.meta.pagination = { mode: "none" };
    return { items: data.map(value => ({
      id: value.id, title: value.title, createdAt: value.created.toISOString(), lastActiveAt: value.lastActive.toISOString(),
      pinned: value.pinned ?? false, role: value.role ?? "build", owner: value.owner ?? null,
      totalCost: value.totalCost === undefined ? null : decimalString(value.totalCost), currency: "USD",
      sharingProhibited: value.sharingProhibited ?? false,
    })) };
  });
}
