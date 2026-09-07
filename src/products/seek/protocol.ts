import * as z from "zod";
import type { RpcTarget } from "capnweb";

// Minimal versioned wire subset, independently maintained from workshop-shared/src/api.ts.
// Response schemas validate remote data before it enters CLI output or credential metadata.
const bounded = z.string().max(4096);
export const user = z.object({ type: z.literal("user"), id: bounded.min(1), name: bounded });
export const serverConfig = z.object({ authVendors: z.array(z.object({ vendorId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), displayName: bounded })).max(100), passwordAuthEnabled: z.boolean() });
export const workspace = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/), title: bounded, created: z.date(), lastActive: z.date(),
  pinned: z.boolean().optional(), owner: user.optional(), role: z.enum(["build", "use"]).optional(),
  totalCost: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), sharingProhibited: z.boolean().optional(),
});

/** The only authenticated RPC methods exposed by the read-only CLI adapter. */
export interface SeekAuthenticated extends RpcTarget {
  whoami(): Promise<z.infer<typeof user>>;
  listGadgets(): Promise<z.infer<typeof workspace>[]>;
}
/** Pending capability owns the login result; its disposal abandons the attempt. */
export interface SeekLoginAttempt extends RpcTarget { wait(): Promise<string> }
/** Public wire methods used by the CLI. No password, account creation or arbitrary RPC entry point. */
export interface SeekPublic extends RpcTarget {
  getServerConfig(): Promise<z.infer<typeof serverConfig>>;
  authenticate(token: string): Promise<SeekAuthenticated>;
  startGatekeeperLogin(vendorId: string): Promise<{ url: string; attempt: SeekLoginAttempt }>;
}
