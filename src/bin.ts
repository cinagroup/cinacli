#!/usr/bin/env node
import { runCli } from "./cli.js";
import { CliError } from "./core/errors.js";
import { readSecretInput } from "./core/secret-input.js";
import { openSystemBrowser } from "./core/browser.js";

const controller = new AbortController();
const interrupt = () => controller.abort(new CliError("CANCELLED"));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  process.exit(1);
});
process.exitCode = await runCli(process.argv.slice(2), {
  io: { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text), isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY) },
  signal: controller.signal,
  readSecret: (signal) => readSecretInput(process.stdin, signal),
  openBrowser: async (url, signal) => { await openSystemBrowser(url, signal); process.stderr.write("已打开系统浏览器，请完成授权；取消请按 Ctrl+C。\n"); },
});
process.removeListener("SIGINT", interrupt);
process.removeListener("SIGTERM", interrupt);
