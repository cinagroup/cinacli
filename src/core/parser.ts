import { parseArgs } from "node:util";
import { CliError } from "./errors.js";
import { commandRegistry, globalFlags } from "./commands.js";
import type { Command, Flag } from "./commands.js";

export interface ParsedCommand {
  command: Command | null;
  input: Record<string, unknown>;
  mode: "execute" | "help" | "version";
  helpPath: string[];
}

export function parseCommand(args: string[]): ParsedCommand {
  const commands = commandRegistry();
  const flags: Record<string, Flag> = { ...globalFlags };
  for (const command of commands) Object.assign(flags, command.flags);
  const options = Object.fromEntries(Object.entries(flags).map(([name, flag]) => [name, { type: flag.type === "boolean" ? "boolean" as const : "string" as const }]));
  let parsed;
  try {
    parsed = parseArgs({ args, options: { ...options, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } }, strict: true, allowPositionals: true, tokens: true });
  } catch { throw new CliError("INVALID_ARGUMENT"); }
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new CliError("INVALID_ARGUMENT", "单值参数不能重复提供。");
    seen.add(token.name);
  }
  const words = parsed.positionals;
  const command = commands.find((candidate) => candidate.path.every((word, index) => word === words[index])) ?? null;
  const input: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(parsed.values)) {
    if (name === "help" || name === "version") continue;
    const flag = (command?.flags ?? globalFlags)[name as keyof typeof globalFlags] as Flag | undefined;
    if (!flag) throw new CliError("INVALID_ARGUMENT");
    input[flag.field] = flag.type === "number" && typeof value === "string" ? Number(value) : value;
  }
  if (parsed.values.version) {
    if (words.length || parsed.values.help) throw new CliError("INVALID_ARGUMENT");
    return { command: null, input, mode: "version", helpPath: [] };
  }
  if (parsed.values.help || words.length === 0) {
    if (words.length && !command && !commands.some((item) => words.every((word, index) => word === item.path[index]))) throw new CliError("INVALID_ARGUMENT");
    if (command && words.length > command.path.length) throw new CliError("INVALID_ARGUMENT");
    return { command, input, mode: "help", helpPath: words };
  }
  if (!command) throw new CliError("INVALID_ARGUMENT", "未知命令；请使用 cina --help 或 cina schema。");
  const remaining = words.slice(command.path.length);
  if (remaining.length > command.positionals.length) throw new CliError("INVALID_ARGUMENT");
  for (let index = 0; index < remaining.length; index++) {
    const name = command.positionals[index];
    if (name) input[name] = remaining[index];
  }
  return { command, input, mode: "execute", helpPath: [] };
}

/** Detect output intent even when parsing fails, without treating values/positionals as flags. */
export function wantsJson(args: string[]): boolean {
  const stringFlags = new Set(commandRegistry().flatMap(command => Object.entries(command.flags).filter(([, flag]) => flag.type !== "boolean").map(([name]) => `--${name}`)));
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") break;
    if (arg === "--json") return true;
    if (arg && stringFlags.has(arg)) index++;
  }
  return false;
}
