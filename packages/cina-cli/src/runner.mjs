import { spawn } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import {
	access,
	lstat,
	open,
	readFile,
	realpath,
	stat,
} from "node:fs/promises";
import { devNull } from "node:os";
import {
	basename,
	dirname,
	delimiter,
	isAbsolute,
	join,
	relative,
	sep,
} from "node:path";
import { assertNodeVersion } from "./manifest.mjs";

/** @typedef {{name: "node" | "npm" | "pnpm" | "forge", version: string | null, lockfile: string | null, nodeVersion?: string | null}} Toolchain */
/** @typedef {{id: string, component: string, capability: string, argv: string[], cwd: string, dependencies: string[], outputs: string[], effects: string[], timeoutMs: number, toolchain: Toolchain, script?: string}} Task */
/** @typedef {{project: string, repoRoot: string, tasks: Task[]}} Plan */
/** @typedef {{available: boolean, name: string, version: string | null, command: string | null, args: string[], error?: string}} ToolResolution */
/** @typedef {{version: string, command: string, args: string[]}} InstalledTool */
/** @typedef {{id: string, status: string, exitCode: number | null, durationMs: number, signal?: string | null, error?: string}} TaskResult */
/** @typedef {{status: string, exitCode: number, tasks: TaskResult[], error?: string}} RunResult */
/** @typedef {{allowLocalWrite?: boolean, signal?: AbortSignal, onOutput?: (task: string, stream: "stdout" | "stderr", chunk: string) => void}} RunOptions */

const managers = new Set(["npm", "pnpm"]);
const capabilities = new Set(["check", "build", "test"]);

/** @type {(error: unknown) => string} */
function message(error) {
	return error instanceof Error ? error.message : String(error);
}

/** @type {(requested: string, actual: string) => boolean} */
function matchesVersion(requested, actual) {
	if (/^\d+$/.test(requested)) {
		return actual.split(".")[0] === requested;
	}
	if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(requested)) {
		return actual === requested;
	}
	return false;
}

/** @type {(root: string, candidate: string) => boolean} */
function within(root, candidate) {
	const path = relative(root, candidate);
	return (
		path === "" ||
		(!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
	);
}

/** @type {(path: string) => Promise<boolean>} */
async function exists(path) {
	try {
		await access(path, constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

/** @type {(metadata: unknown) => metadata is {name: string, version: string, bin?: string | Record<string, string>, main?: string, type?: string, files?: string[], os?: string[], cpu?: string[], optionalDependencies?: Record<string, string>, publishConfig?: {executableFiles?: string[]}}} */
function packageMetadata(metadata) {
	return (
		metadata !== null &&
		typeof metadata === "object" &&
		"name" in metadata &&
		typeof metadata.name === "string" &&
		"version" in metadata &&
		typeof metadata.version === "string" &&
		/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(metadata.version)
	);
}

/** Inspect a native header without executing a wrapper or loading its code. @type {(entry: string) => Promise<boolean>} */
async function nativeHeader(entry) {
	const file = await open(entry, "r");
	try {
		const header = Buffer.alloc(4);
		const { bytesRead } = await file.read(header, 0, header.length, 0);
		if (bytesRead !== header.length) {
			return false;
		}
		if (process.platform === "win32") {
			return header[0] === 0x4d && header[1] === 0x5a;
		}
		if (process.platform === "darwin") {
			return [
				0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
			].includes(header.readUInt32BE());
		}
		return header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
	} finally {
		await file.close();
	}
}

/** @type {(root: string) => Promise<InstalledTool | null>} */
async function nativePnpm(root) {
	const metadata = JSON.parse(
		await readFile(join(root, "package.json"), "utf8")
	);
	if (
		!packageMetadata(metadata) ||
		!nativePnpmNames().includes(metadata.name) ||
		!Array.isArray(metadata.os) ||
		!metadata.os.includes(process.platform) ||
		!Array.isArray(metadata.cpu) ||
		!metadata.cpu.includes(process.arch)
	) {
		return null;
	}
	const filename = process.platform === "win32" ? "pnpm.exe" : "pnpm";
	const declared = metadata.name.startsWith("@pnpm/exe.")
		? Array.isArray(metadata.publishConfig?.executableFiles) &&
			metadata.publishConfig.executableFiles.includes(`./${filename}`)
		: Array.isArray(metadata.files) && metadata.files.includes(filename);
	if (!declared) {
		return null;
	}
	const packageRoot = await realpath(root);
	const entry = await realpath(join(packageRoot, filename));
	// pnpm 11's SEA executable is a loader for its sibling JS runtime.
	// ignore-scripts installations can contain the binary without that payload.
	if (!metadata.name.startsWith("@pnpm/exe.")) {
		const bundle = await realpath(join(packageRoot, "dist", "pnpm.mjs"));
		if (!within(packageRoot, bundle) || !(await stat(bundle)).isFile()) {
			return null;
		}
	}
	if (
		!within(packageRoot, entry) ||
		!(await stat(entry)).isFile() ||
		!(await nativeHeader(entry))
	) {
		return null;
	}
	return { version: metadata.version, command: entry, args: [] };
}

/** Package names verified from the installed pnpm 11 and 12 platform maps. @type {() => string[]} */
function nativePnpmNames() {
	const name = `@pnpm/exe.${process.platform}-${process.arch}`;
	const legacyOs =
		process.platform === "win32"
			? "win"
			: process.platform === "darwin"
				? "macos"
				: process.platform;
	const legacyArch =
		process.platform === "win32" && process.arch === "ia32"
			? "x86"
			: process.arch;
	return [
		name,
		`@pnpm/${legacyOs}-${legacyArch}`,
		...(process.platform === "linux"
			? [`${name}-musl`, `@pnpm/linuxstatic-${process.arch}`]
			: []),
	];
}

/** Recognize installed shim targets; never evaluate arbitrary shim code. @type {(shim: string, entry: string) => Promise<boolean>} */
async function shimPointsTo(shim, entry) {
	if ((await realpath(shim)) === entry) {
		return true;
	}
	if ((await stat(shim)).size > 65536) {
		return false;
	}
	let content = (await readFile(shim, "utf8")).replaceAll("\\", "/");
	const shimDirectory = await realpath(dirname(shim));
	let offset = relative(shimDirectory, entry).split(sep).join("/");
	if (process.platform === "win32") {
		content = content.toLowerCase();
		offset = offset.toLowerCase();
	}
	return ["%dp0%", "%~dp0", "%~dp0%", "$basedir", "${basedir}"].some((prefix) =>
		content.includes(`${prefix}/${offset}`)
	);
}

/** @type {(root: string, tool: string, shim: string) => Promise<InstalledTool | null>} */
async function installedManager(root, tool, shim) {
	const metadata = JSON.parse(
		await readFile(join(root, "package.json"), "utf8")
	);
	if (!packageMetadata(metadata)) {
		return null;
	}
	if (tool === "pnpm" && nativePnpmNames().includes(metadata.name)) {
		const native = await nativePnpm(root);
		return native && (await shimPointsTo(shim, native.command)) ? native : null;
	}
	if (
		metadata.name !== tool &&
		!(tool === "pnpm" && metadata.name === "@pnpm/exe")
	) {
		return null;
	}
	const bin =
		typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.[tool];
	if (typeof bin !== "string") {
		return null;
	}
	const packageRoot = await realpath(root);
	const entry = await realpath(join(packageRoot, bin));
	if (
		!within(packageRoot, entry) ||
		!(await stat(entry)).isFile() ||
		!(await shimPointsTo(shim, entry))
	) {
		return null;
	}
	const legacyEntry = tool === "npm" ? "bin/npm-cli.js" : "bin/pnpm.cjs";
	if (bin.replaceAll("\\", "/").replace(/^\.\//, "") === legacyEntry) {
		return {
			version: metadata.version,
			command: await realpath(process.execPath),
			args: [entry],
		};
	}
	// The installed pnpm 11 JS entry only checks Node and imports its bundle;
	// pnpm 12's Corepack entry can download and is never selected here.
	if (
		tool === "pnpm" &&
		metadata.name === "pnpm" &&
		metadata.version.startsWith("11.") &&
		bin === "bin/pnpm.mjs" &&
		metadata.main === bin &&
		metadata.type === "module"
	) {
		const bundle = await realpath(join(packageRoot, "dist", "pnpm.mjs"));
		if (!within(packageRoot, bundle) || !(await stat(bundle)).isFile()) {
			return null;
		}
		return {
			version: metadata.version,
			command: await realpath(process.execPath),
			args: [entry],
		};
	}
	if (tool !== "pnpm") {
		return null;
	}
	// pnpm 11/12 wrappers may download. Resolve only their already-installed
	// platform dependency, with matching metadata, and execute the binary itself.
	/** @type {InstalledTool[]} */ const candidates = [];
	for (const packageName of nativePnpmNames()) {
		if (metadata.optionalDependencies?.[packageName] !== metadata.version) {
			continue;
		}
		for (const modules of [
			join(packageRoot, "node_modules"),
			metadata.name.startsWith("@")
				? dirname(dirname(packageRoot))
				: dirname(packageRoot),
		]) {
			try {
				const native = await nativePnpm(
					join(modules, ...packageName.split("/"))
				);
				if (
					native?.version === metadata.version &&
					!candidates.some((candidate) => candidate.command === native.command)
				) {
					candidates.push(native);
				}
			} catch {
				/* Missing or invalid installed dependencies cannot trigger a download. */
			}
		}
	}
	return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

/**
 * Resolve installed tools by reading metadata only. Corepack proxies are not
 * executed: they can download a package manager. Native binaries without
 * trustworthy static version metadata are deliberately unresolved.
 * @type {(toolchain: Toolchain) => Promise<ToolResolution>}
 */
export async function resolveTool(toolchain) {
	/** @type {ToolResolution} */
	const result = {
		available: false,
		name: toolchain.name,
		version: null,
		command: null,
		args: [],
	};
	try {
		assertNodeVersion(toolchain.nodeVersion);
		if (toolchain.name === "node") {
			result.version = process.versions.node;
			result.command = await realpath(process.execPath);
		} else if (managers.has(toolchain.name)) {
			const tool = toolchain.name;
			const directories = [
				...new Set([
					dirname(process.execPath),
					...(process.env.PATH ?? "").split(delimiter).filter(isAbsolute),
				]),
			];
			const found = new Set();
			for (const directory of directories) {
				const names =
					process.platform === "win32"
						? [
								...(tool === "pnpm" ? ["pnpm.exe"] : []),
								`${tool}.cmd`,
								tool,
								...(tool === "pnpm" ? ["pnpm.mjs", "pnpm.cjs"] : []),
							]
						: [tool, ...(tool === "pnpm" ? ["pnpm.mjs", "pnpm.cjs"] : [])];
				for (const name of names) {
					const shim = join(directory, name);
					if (!(await exists(shim))) {
						continue;
					}
					const target = await realpath(shim);
					const roots = [
						join(directory, "node_modules", tool),
						...(tool === "pnpm"
							? [join(directory, "node_modules", "@pnpm", "exe")]
							: []),
						...(basename(directory) === ".bin"
							? [
									join(dirname(directory), tool),
									...(tool === "pnpm"
										? [join(dirname(directory), "@pnpm", "exe")]
										: []),
								]
							: []),
						dirname(target),
						dirname(dirname(target)),
					];
					for (const root of roots) {
						try {
							const installed = await installedManager(root, tool, shim);
							if (!installed) {
								continue;
							}
							found.add(installed.version);
							if (
								toolchain.version !== null &&
								!matchesVersion(toolchain.version, installed.version)
							) {
								continue;
							}
							result.version = installed.version;
							result.command = installed.command;
							result.args = installed.args;
							break;
						} catch {
							// A PATH entry is not proof of an installed manager.
						}
					}
					if (result.command) {
						break;
					}
				}
				if (result.command) {
					break;
				}
			}
			if (!result.command && found.size > 0) {
				result.version = [...found][0] ?? null;
				result.error = `Expected ${toolchain.name} ${toolchain.version}, found ${[...found].join(", ")}; use a major or exact version`;
			}
		} else if (toolchain.name === "forge") {
			result.error =
				"forge requires static version metadata; this runner does not probe binaries";
		} else {
			result.error = `Unsupported toolchain: ${toolchain.name}`;
		}
		if (!result.command) {
			result.error ??= `No installed ${toolchain.name} CLI with trusted metadata found; install is never automatic`;
			return result;
		}
		if (
			toolchain.version !== null &&
			!matchesVersion(toolchain.version, result.version ?? "")
		) {
			result.error = `Expected ${toolchain.name} ${toolchain.version}, found ${result.version}; use a major or exact version`;
			return result;
		}
		result.available = true;
		return result;
	} catch (error) {
		result.error = message(error);
		return result;
	}
}

/**
 * Repository scripts remain trusted code, not an OS sandbox. Credentials and
 * user configuration are not inherited; declared network effects are refused.
 * Uses the existing task cwd rather than the user's home.
 * @type {(directory: string, tool?: string) => NodeJS.ProcessEnv}
 */
function isolatedEnvironment(directory, tool = "node") {
	/** @type {NodeJS.ProcessEnv} */
	const environment = {};
	const allowed = new Set([
		"path",
		"systemroot",
		"windir",
		"comspec",
		"pathext",
		"tmp",
		"temp",
		"tmpdir",
		"lang",
		"lc_all",
		"lc_ctype",
	]);
	for (const [key, value] of Object.entries(process.env)) {
		if (allowed.has(key.toLowerCase()) && value !== undefined) {
			environment[key] = value;
		}
	}
	if (managers.has(tool)) {
		const paths = Object.entries(environment).filter(
			([key]) => key.toLowerCase() === "path"
		);
		for (const [key] of paths) {
			delete environment[key];
		}
		environment.PATH = [
			dirname(realpathSync(process.execPath)),
			...paths.map(([, value]) => value).filter(Boolean),
		].join(delimiter);
	}
	return {
		...environment,
		// libuv restores USERPROFILE on Windows when omitted from an env block.
		// Use an existing controlled directory: npm requires os.homedir().
		HOME: directory,
		USERPROFILE: directory,
		CI: "true",
		NO_COLOR: "1",
		DO_NOT_TRACK: "1",
		TURBO_TELEMETRY_DISABLED: "1",
		WRANGLER_SEND_METRICS: "false",
		ASTRO_TELEMETRY_DISABLED: "1",
		// Managers cannot pick up user/global npmrc files or fetch on demand.
		NPM_CONFIG_USERCONFIG: devNull,
		NPM_CONFIG_GLOBALCONFIG: join(
			directory,
			".cina-cache",
			"disabled-global.npmrc"
		),
		NPM_CONFIG_OFFLINE: "true",
		NPM_CONFIG_AUDIT: "false",
		NPM_CONFIG_FUND: "false",
		NPM_CONFIG_IGNORE_SCRIPTS: "true",
		...(tool === "pnpm"
			? { NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: "false" }
			: {}),
		NODE_DISABLE_COMPILE_CACHE: "1",
		COREPACK_ENABLE_NETWORK: "0",
		NPM_CONFIG_LOGS_MAX: "0",
		NPM_CONFIG_CACHE: join(directory, ".cina-cache", "npm"),
	};
}

/** @type {(task: Task, root: string) => Promise<void>} */
async function validatePackageScript(task, root) {
	if (!managers.has(task.toolchain.name)) {
		return;
	}
	// Windows short paths and directory aliases must use the root's real spelling.
	const cwd = await realpath(task.cwd);
	await validateFuturePath(root, join(cwd, ".cina-cache", "npm"));
	const disabledConfig = join(cwd, ".cina-cache", "disabled-global.npmrc");
	await validateFuturePath(root, disabledConfig);
	if (await exists(disabledConfig)) {
		throw new Error(`${task.id}: isolated global config must remain absent`);
	}
	const packageFile = await realpath(join(cwd, "package.json"));
	if (!within(root, packageFile)) {
		throw new Error(`${task.id}: package.json escapes repository root`);
	}
	const pkg = JSON.parse(await readFile(packageFile, "utf8"));
	const name = task.argv[2] ?? "";
	if (typeof pkg.scripts?.[name] !== "string") {
		throw new Error(`${task.id}: package script is missing`);
	}
	if (task.script !== undefined && pkg.scripts[name] !== task.script) {
		throw new Error(`${task.id}: package script changed since manifest review`);
	}
	if (
		Object.hasOwn(pkg.scripts, `pre${name}`) ||
		Object.hasOwn(pkg.scripts, `post${name}`)
	) {
		throw new Error(
			`${task.id}: implicit pre/post lifecycle hooks require explicit task modeling`
		);
	}
}

/** Validate existing ancestors of a future cache path without creating it. @type {(root: string, path: string) => Promise<void>} */
async function validateFuturePath(root, path) {
	let ancestor = path;
	while (within(root, ancestor)) {
		let present = false;
		try {
			await lstat(ancestor);
			present = true;
			if (!within(root, await realpath(ancestor))) {
				throw new Error("Cache/config path escapes repository root");
			}
			return;
		} catch (error) {
			if (
				present ||
				/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT"
			) {
				throw error;
			}
		}
		ancestor = dirname(ancestor);
	}
	throw new Error("Cache/config path escapes repository root");
}

/** @type {(task: Task) => void} */
function validateCommand(task) {
	if (
		!Array.isArray(task.argv) ||
		task.argv.length < 2 ||
		task.argv.some(
			(arg) => typeof arg !== "string" || arg.length === 0 || arg.includes("\0")
		)
	) {
		throw new Error(
			`${task.id}: argv must contain an executable and arguments without NUL`
		);
	}
	if (!task.toolchain || task.argv[0] !== task.toolchain.name) {
		throw new Error(
			`${task.id}: argv executable must match the declared toolchain`
		);
	}
	if (
		managers.has(task.toolchain.name) &&
		(task.argv[1] !== "run" ||
			!/^[\w:][\w:-]*$/.test(task.argv[2] ?? "") ||
			!(
				task.argv.length === 3 ||
				(task.toolchain.name === "npm" &&
					task.argv.length >= 5 &&
					task.argv[3] === "--")
			))
	) {
		throw new Error(
			`${task.id}: only an explicit installed package-manager run script is supported`
		);
	}
	if (
		task.toolchain.name === "forge" &&
		!["build", "test"].includes(task.argv[1] ?? "")
	) {
		throw new Error(`${task.id}: only local forge build/test is supported`);
	}
}

/** @type {(plan: Plan, allowLocalWrite: boolean) => Promise<{root: string, tools: Map<string, ToolResolution>, sorted: Task[]}>} */
async function preflight(plan, allowLocalWrite) {
	if (
		!plan ||
		!isAbsolute(plan.repoRoot) ||
		!Array.isArray(plan.tasks) ||
		plan.tasks.length === 0
	) {
		throw new Error(
			"Plan requires an absolute repository root and at least one task"
		);
	}
	const root = await realpath(plan.repoRoot);
	const byId = new Map(plan.tasks.map((task) => [task.id, task]));
	if (byId.size !== plan.tasks.length) {
		throw new Error("Task IDs must be unique");
	}
	/** @type {Map<string, ToolResolution>} */
	const tools = new Map();
	for (const task of plan.tasks) {
		if (!capabilities.has(task.capability)) {
			throw new Error(`${task.id}: unsupported capability ${task.capability}`);
		}
		if (
			!Array.isArray(task.effects) ||
			task.effects.length === 0 ||
			task.effects.some(
				(effect) => !["local-read", "local-write"].includes(effect)
			)
		) {
			throw new Error(`${task.id}: only declared local effects are executable`);
		}
		if (task.effects.includes("local-write") && !allowLocalWrite) {
			throw new Error(
				`${task.id}: local-write requires explicit authorization`
			);
		}
		if (
			managers.has(task.toolchain?.name) &&
			!task.effects.includes("local-write")
		) {
			throw new Error(
				`${task.id}: package managers require local-write for cache and log effects`
			);
		}
		if (!isAbsolute(task.cwd) || !within(root, await realpath(task.cwd))) {
			throw new Error(`${task.id}: cwd escapes repository root`);
		}
		if (
			!Array.isArray(task.dependencies) ||
			task.dependencies.some((id) => id === task.id || !byId.has(id))
		) {
			throw new Error(
				`${task.id}: dependencies must refer to other plan tasks`
			);
		}
		if (
			!Number.isSafeInteger(task.timeoutMs) ||
			task.timeoutMs < 1 ||
			task.timeoutMs > 2_147_483_647
		) {
			throw new Error(
				`${task.id}: timeoutMs must be a positive bounded integer`
			);
		}
		validateCommand(task);
		await validatePackageScript(task, root);
		const tool = await resolveTool(task.toolchain);
		if (!tool.available) {
			throw new Error(`${task.id}: ${tool.error}`);
		}
		tools.set(task.id, tool);
	}
	/** @type {Task[]} */
	const sorted = [];
	const pending = new Set(byId.keys());
	while (pending.size) {
		const ready = [...pending].filter((id) =>
			byId.get(id)?.dependencies.every((dep) => !pending.has(dep))
		);
		if (ready.length === 0) {
			throw new Error("Task dependency cycle detected");
		}
		for (const id of ready) {
			pending.delete(id);
			const task = byId.get(id);
			if (task) {
				sorted.push(task);
			}
		}
	}
	return { root, tools, sorted };
}

/** @type {(pid: number) => Promise<void>} */
async function terminateTree(pid) {
	if (process.platform === "win32") {
		const systemRoot = Object.entries(process.env).find(
			([key]) => key.toLowerCase() === "systemroot"
		)?.[1];
		if (!systemRoot || !isAbsolute(systemRoot)) {
			throw new Error("Cannot resolve Windows taskkill safely");
		}
		await new Promise((resolve, reject) => {
			const killer = spawn(
				join(systemRoot, "System32", "taskkill.exe"),
				["/PID", String(pid), "/T", "/F"],
				{
					shell: false,
					windowsHide: true,
					stdio: "ignore",
					env: isolatedEnvironment(process.cwd()),
				}
			);
			killer.once("error", reject);
			killer.once("close", (code) =>
				code === 0
					? resolve(undefined)
					: reject(new Error(`taskkill exited ${code}`))
			);
		});
		return;
	}
	try {
		process.kill(-pid, "SIGTERM");
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH") {
			throw error;
		}
	}
	await new Promise((resolve) => setTimeout(resolve, 250));
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH") {
			throw error;
		}
	}
}

/** @type {(task: Task, tool: ToolResolution, options: RunOptions) => Promise<TaskResult>} */
async function execute(task, tool, options) {
	const start = performance.now();
	if (!tool.command) {
		return {
			id: task.id,
			status: "invalid",
			exitCode: 2,
			durationMs: 0,
			error: "Tool resolution has no command",
		};
	}
	return new Promise((resolve) => {
		const child = spawn(
			tool.command ?? "",
			[...tool.args, ...task.argv.slice(1)],
			{
				cwd: task.cwd,
				env: isolatedEnvironment(task.cwd, task.toolchain.name),
				shell: false,
				windowsHide: true,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			}
		);
		/** @type {"timeout" | "cancelled" | null} */
		let interrupted = null;
		/** @type {Promise<void> | null} */
		let termination = null;
		/** @type {string | undefined} */
		let error;
		const stop = (/** @type {"timeout" | "cancelled"} */ reason) => {
			if (interrupted) {
				return;
			}
			interrupted = reason;
			if (child.pid) {
				termination = terminateTree(child.pid).catch((cause) => {
					error = `Process-tree termination failed: ${message(cause)}`;
					child.kill("SIGKILL");
				});
			}
		};
		const timer = setTimeout(() => stop("timeout"), task.timeoutMs);
		const cancel = () => stop("cancelled");
		options.signal?.addEventListener("abort", cancel, { once: true });
		if (options.signal?.aborted) {
			cancel();
		}
		for (const stream of /** @type {const} */ (["stdout", "stderr"])) {
			child[stream]?.on("data", (chunk) => {
				try {
					options.onOutput?.(task.id, stream, String(chunk));
				} catch (cause) {
					error = `Output callback failed: ${message(cause)}`;
				}
			});
		}
		child.once("error", (cause) => {
			error = message(cause);
		});
		child.once("close", async (code, signal) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", cancel);
			if (termination) {
				await termination;
			}
			const status =
				interrupted ?? (code === 0 && !error ? "success" : "failed");
			const exitCode =
				interrupted === "timeout"
					? 124
					: interrupted === "cancelled"
						? 130
						: (code ?? 1);
			resolve({
				id: task.id,
				status,
				exitCode,
				signal,
				durationMs: Math.round(performance.now() - start),
				...(error ? { error } : {}),
			});
		});
	});
}

/**
 * Execute local native tasks sequentially. Preflight is atomic: an invalid
 * task prevents every task from starting. Failed dependencies are skipped,
 * while independent tasks continue. Timeout kills the process tree; abort
 * stops all remaining tasks. No installation, login or deployment fallback.
 * @type {(plan: Plan, options?: RunOptions) => Promise<RunResult>}
 */
export async function runPlan(plan, options = {}) {
	let prepared;
	try {
		prepared = await preflight(plan, options.allowLocalWrite ?? false);
	} catch (error) {
		return { status: "invalid", exitCode: 2, tasks: [], error: message(error) };
	}
	/** @type {TaskResult[]} */
	const results = [];
	const byId = new Map();
	for (const task of prepared.sorted) {
		/** @type {TaskResult} */
		let result;
		if (options.signal?.aborted) {
			result = {
				id: task.id,
				status: "cancelled",
				exitCode: 130,
				durationMs: 0,
			};
		} else if (
			task.dependencies.some((id) => byId.get(id)?.status !== "success")
		) {
			result = {
				id: task.id,
				status: "skipped",
				exitCode: null,
				durationMs: 0,
				error: "Dependency did not succeed",
			};
		} else {
			try {
				// Re-resolve immediately before spawning, even if the plan was forged
				// or a symlink changed after preflight. This is not an OS sandbox.
				const cwd = await realpath(task.cwd);
				if (!within(prepared.root, cwd)) {
					throw new Error("cwd escapes repository root at execution time");
				}
				const tool = prepared.tools.get(task.id);
				await validatePackageScript({ ...task, cwd }, prepared.root);
				if (!tool) {
					throw new Error("Tool resolution is missing");
				}
				result = await execute({ ...task, cwd }, tool, options);
			} catch (error) {
				result = {
					id: task.id,
					status: "invalid",
					exitCode: 2,
					durationMs: 0,
					error: message(error),
				};
			}
		}
		results.push(result);
		byId.set(task.id, result);
	}
	const failed = results.filter((result) => result.status !== "success");
	if (results.some((result) => result.status === "cancelled")) {
		return { status: "cancelled", exitCode: 130, tasks: results };
	}
	if (failed.length === 0) {
		return { status: "success", exitCode: 0, tasks: results };
	}
	if (results.some((result) => result.status === "success")) {
		return { status: "partial", exitCode: 1, tasks: results };
	}
	if (results.some((result) => result.status === "timeout")) {
		return { status: "timeout", exitCode: 124, tasks: results };
	}
	if (results.some((result) => result.status === "invalid")) {
		return { status: "invalid", exitCode: 2, tasks: results };
	}
	return { status: "failure", exitCode: 1, tasks: results };
}
