import * as z from "zod";
import { define } from "../../core/command.js";

export const identitySchema = z.strictObject({ id: z.string(), name: z.string(), type: z.literal("user") });
export const workspaceSchema = z.strictObject({
  id: z.string(), title: z.string(), createdAt: z.iso.datetime(), lastActiveAt: z.iso.datetime(),
  pinned: z.boolean(), role: z.enum(["build", "use"]), owner: identitySchema.nullable(),
  totalCost: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(), currency: z.literal("USD"), sharingProhibited: z.boolean(),
});
const read = { effect: "business-read" as const, contextRequirements: ["selected context", "seek.endpoint"] };
const authentication = [{ scheme: "seek-session", scopes: [], permissions: ["AuthenticatedApi read access"] }];

export const seekCommands = [
  define({ id: "seek.status", summary: "读取 RPC 服务配置和可用的浏览器登录方式", ...read, shape: {},
    output: z.strictObject({ vendors: z.array(z.strictObject({ id: z.string(), name: z.string() })), passwordAuthEnabled: z.boolean(),
      clientProtocol: z.literal("capnweb/0.12.0"), serverVersion: z.null(), accessAuthentication: z.literal("not-supported") }),
    run: async (input, runtime) => (await import("./handler.js")).seekStatus(input, runtime),
  }),
  define({ id: "seek.whoami", summary: "查询当前 Seek 会话的服务端身份", ...read, authentication, shape: {}, output: identitySchema,
    run: async (input, runtime) => (await import("./handler.js")).seekWhoami(input, runtime),
  }),
  define({ id: "seek.workspaces.list", summary: "列出当前 Seek 用户的非临时工作区", ...read, authentication, shape: {},
    output: z.strictObject({ items: z.array(workspaceSchema) }),
    run: async (input, runtime) => (await import("./handler.js")).listWorkspaces(input, runtime),
  }),
];
