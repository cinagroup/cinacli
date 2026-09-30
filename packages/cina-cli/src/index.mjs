import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
	PROJECTS,
	containedPath,
	createPlan,
	loadManifest,
	repositoryRoot,
} from "./manifest.mjs";

const HELP = `cina — local engineering tasks for seven Cina projects

  cina inspect [--project NAME] [--repo PATH]
  cina doctor --project NAME --repo PATH
  cina plan CAPABILITY --project NAME --repo PATH [--component NAME]
  cina run CAPABILITY --project NAME --repo PATH [--component NAME] --allow-local-write

inspect, doctor and plan only read static JSON and local files.
run supports declared check/build/test tasks; scripts can write local artifacts.
No install, login, deploy, config evaluation, telemetry or cf fallback.
All command results are JSON. Exit: 0 success, 1 failure/partial, 2 invalid,
124 timeout, 130 cancelled. Configured projects are pending execution validation.
`;

/** @type {(argv: string[]) => {command: string | undefined, positional: string[], options: Record<string, string | boolean>}} */
function parse(argv) {
	const command = argv[0];
	const positional = [];
	/** @type {Record<string, string|boolean>} */ const options = {};
	for (let i = 1; i < argv.length; i++) {
		const arg = argv[i] ?? "";
		if (arg.startsWith("--")) {
			if (
				!["--project", "--repo", "--component", "--allow-local-write"].includes(
					arg
				) ||
				options[arg] !== undefined
			) {
				throw new Error(`Unknown or duplicate option: ${arg}`);
			}
			if (arg === "--allow-local-write") {
				options[arg] = true;
			} else {
				const value = argv[++i];
				if (!value || value.startsWith("--")) {
					throw new Error(`Missing value: ${arg}`);
				}
				options[arg] = value;
			}
		} else {
			positional.push(arg);
		}
	}
	return { command, positional, options };
}

/** @type {(value: unknown) => void} */
function print(value) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Stateless entry point. @type {(argv?: string[]) => Promise<number>} */
export async function main(argv = process.argv.slice(2)) {
	if (
		argv.length === 0 ||
		(argv.length === 1 && ["--help", "-h", "help"].includes(argv[0] ?? ""))
	) {
		process.stdout.write(HELP);
		return 0;
	}
	try {
		if (argv.length === 1 && argv[0] === "--version") {
			const pkg = JSON.parse(
				readFileSync(new URL("../package.json", import.meta.url), "utf8")
			);
			print({ name: "@cinagroup/cli", version: pkg.version });
			return 0;
		}
		const { command, positional, options } = parse(argv);
		if (!["inspect", "doctor", "plan", "run"].includes(command ?? "")) {
			throw new Error("Unknown command");
		}
		const project =
			typeof options["--project"] === "string"
				? options["--project"]
				: undefined;
		const repo =
			typeof options["--repo"] === "string" ? options["--repo"] : undefined;
		const component =
			typeof options["--component"] === "string"
				? options["--component"]
				: undefined;
		if (command !== "run" && options["--allow-local-write"]) {
			throw new Error("--allow-local-write applies only to run");
		}
		if (
			["inspect", "doctor"].includes(command ?? "") &&
			(component || positional.length)
		) {
			throw new Error("Unexpected arguments");
		}
		if (command === "inspect") {
			if (!project && repo) {
				throw new Error("--repo requires --project");
			}
			print(
				project
					? loadManifest(project, repo)
					: {
							schemaVersion: 1,
							projects: PROJECTS.map((name) => {
								const manifest = loadManifest(name);
								return {
									project: name,
									components: manifest.components.map(
										(entry) => entry.component
									),
									source: manifest.source,
									verification: manifest.verification,
								};
							}),
						}
			);
			return 0;
		}
		if (!project || !repo) {
			throw new Error("--project and --repo are required");
		}
		const manifest = loadManifest(project, repo);
		if (command === "doctor") {
			const root = repositoryRoot(repo);
			const { resolveTool } = await import("./runner.mjs");
			/** @type {{component:string, ok:boolean, issues:string[], tool:unknown}[]} */ const checks =
				[];
			for (const entry of manifest.components) {
				/** @type {string[]} */ const issues = [];
				try {
					containedPath(root, manifest.root);
					containedPath(root, entry.root);
					if (entry.toolchain.lockfile) {
						containedPath(root, entry.toolchain.lockfile);
					}
					for (const task of entry.tasks) {
						createPlan(manifest, root, task.capability, entry.component);
					}
					if (
						["npm", "pnpm"].includes(entry.toolchain.name) &&
						!existsSync(path.join(root, entry.root, "node_modules")) &&
						!existsSync(path.join(root, "node_modules"))
					) {
						issues.push(
							"Dependencies are not installed; doctor does not install them"
						);
					}
				} catch (error) {
					issues.push(error instanceof Error ? error.message : String(error));
				}
				const tool = await resolveTool(entry.toolchain);
				if (!tool.available) {
					issues.push(tool.error ?? "Tool unavailable");
				}
				checks.push({
					component: entry.component,
					ok: issues.length === 0,
					issues,
					tool,
				});
			}
			const ok = checks.every((check) => check.ok);
			print({
				project,
				status: ok ? "ready" : "blocked",
				verification: manifest.verification,
				checks,
				notes: manifest.notes,
			});
			return ok ? 0 : 1;
		}
		if (positional.length !== 1) {
			throw new Error("Exactly one capability is required");
		}
		const plan = createPlan(manifest, repo, positional[0] ?? "", component);
		if (command === "plan") {
			print(plan);
			return 0;
		}
		const { runPlan } = await import("./runner.mjs");
		const controller = new AbortController();
		const cancel = () => controller.abort();
		process.once("SIGINT", cancel);
		process.once("SIGTERM", cancel);
		try {
			const result = await runPlan(plan, {
				allowLocalWrite: options["--allow-local-write"] === true,
				signal: controller.signal,
				onOutput: (_id, _stream, output) => process.stderr.write(output),
			});
			print({ project, ...result });
			return result.exitCode;
		} finally {
			process.removeListener("SIGINT", cancel);
			process.removeListener("SIGTERM", cancel);
		}
	} catch (error) {
		print({
			status: "invalid",
			exitCode: 2,
			error: error instanceof Error ? error.message : String(error),
		});
		return 2;
	}
}
