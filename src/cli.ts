import { readFileSync } from "node:fs";
import { commandRegistry, commandSchema, globalShape } from "./core/commands.js";
import { configDirectory } from "./core/context/store.js";
import { systemSecretStore } from "./core/credentials/store.js";
import { CliError, safeError } from "./core/errors.js";
import { parseCommand, wantsJson } from "./core/parser.js";
import { deadline } from "./core/transport.js";
import * as z from "zod";
import type { Environment } from "./core/context/store.js";
import type { SecretStore } from "./core/credentials/store.js";
import type { Runtime } from "./core/commands.js";

export const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
export interface CliIO { out: (text: string) => void; err: (text: string) => void; isTTY: boolean }
export interface RunOptions { env?: Environment; io: CliIO; signal?: AbortSignal; store?: SecretStore }

/** Dependency injection keeps offline commands testable without filesystem/network/credential access. */
export async function runCli(args: string[], options: RunOptions): Promise<number> {
  let json = wantsJson(args);
  let commandId: string | null = null;
  let runtime: Runtime | undefined;
  let timer: ReturnType<typeof deadline> | undefined;
  try {
    const parsed = parseCommand(args);
    commandId = parsed.command?.id ?? (parsed.mode === "execute" ? null : parsed.mode);
    const globals = z.object(globalShape).safeParse(parsed.input);
    if (!globals.success) throw new CliError("INVALID_ARGUMENT");
    json = globals.data.json;
    if (parsed.mode === "version") {
      emit({ version, node: process.versions.node }, commandId, null, json, options.io, `Cina CLI ${version}\n`);
      return 0;
    }
    if (parsed.mode === "help") {
      const selected = parsed.command ? [parsed.command] : commandRegistry().filter((item) => parsed.helpPath.every((word, index) => item.path[index] === word));
      const help = [`Cina CLI ${version}`, "", ...selected.map((item) => {
        const schema = z.toJSONSchema(item.input, { io: "input" });
        const required = schema.required ?? [];
        const argumentsText = item.positionals.map((arg) => required.includes(arg) ? ` <${arg}>` : ` [${arg}]`).join("");
        return `  cina ${item.path.join(" ")}${argumentsText}\n    ${item.summary}`;
      }), "", "公共参数：--context <name>  --json  --no-input  --timeout <seconds>  --help",
      ...(parsed.command ? Object.entries(parsed.command.flags).filter(([name]) => !["context", "json", "no-input", "timeout"].includes(name)).map(([name, flag]) => `  --${name}${flag.type === "boolean" ? "" : ` <${flag.field}>`}`) : []),
      "使用 cina schema <command-id> --json 查看字段和返回结构。", "M0：产品业务命令尚未接入。", ""].join("\n");
      emit({ version, commands: selected.map(commandSchema) }, commandId, null, json, options.io, help);
      return 0;
    }
    if (!parsed.command) throw new CliError("INVALID_ARGUMENT");
    timer = deadline(globals.data.timeout * 1000, options.signal);
    const env = options.env ?? process.env;
    runtime = {
      env, directory: () => configDirectory(env), signal: timer.signal,
      store: options.store ?? systemSecretStore(), version, context: null,
    };
    runtime.signal.throwIfAborted();
    const input = { ...parsed.input, noInput: globals.data.noInput || !options.io.isTTY || json };
    const result = await parsed.command.run(input, runtime);
    emit(result, commandId, runtime.context, json, options.io);
    return 0;
  } catch (caught) {
    const error = safeError(caught);
    if (json) options.io.out(`${JSON.stringify({ contractVersion: "1", ok: false, command: commandId, context: runtime?.context ?? null, error: { code: error.code, message: error.message, retryable: error.retryable } })}\n`);
    else options.io.err(`${error.code}: ${error.message}\n`);
    return error.exitCode;
  } finally { timer?.dispose(); }
}

function emit(data: unknown, command: string | null, context: Runtime["context"], json: boolean, io: CliIO, human?: string): void {
  if (json) io.out(`${JSON.stringify({ contractVersion: "1", ok: true, command, context, data, meta: {} })}\n`);
  else io.out(human ?? `${JSON.stringify(data, null, 2)}\n`);
}
