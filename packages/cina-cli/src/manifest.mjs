import {
	existsSync,
	lstatSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECTS = Object.freeze([
	"cinagroup",
	"cinatoken",
	"cinashop",
	"cinaseek",
	"cinachain",
	"cinaauth",
	"cinaclassics",
]);

/** @typedef {{ name: 'npm'|'pnpm'|'node'|'forge', version: string|null, lockfile: string|null, nodeVersion?: string|null }} Toolchain */
/** @typedef {{ task: string, capability: 'check'|'build'|'test'|'deploy', argv: string[], cwd: string, dependencies: string[], outputs: string[], effects: ('local-read'|'local-write'|'network-read'|'remote-write')[], timeoutMs: number, script?: string }} Task */
/** @typedef {{ component: string, root: string, toolchain: Toolchain, credentialRefs: string[], tasks: Task[] }} Component */
/** @typedef {{ schemaVersion: 1, project: string, root: string, source: {repository: string, commit: string}, verification: 'configured-pending-validation', notes: string[], components: Component[] }} Manifest */
/** @typedef {Task & { id: string, component: string, toolchain: Toolchain }} PlannedTask */
/** @typedef {{project: string, repoRoot: string, source: Manifest['source'], verification: string, tasks: PlannedTask[], effects: string[]}} Plan */

/** @type {(value: unknown, message: string) => asserts value} */
function requireValue(value, message) {
	if (!value) {
		throw new Error(message);
	}
}
/** @type {(version: string | null | undefined) => void} */
export function assertNodeVersion(version) {
	if (version === undefined || version === null) {
		return;
	}
	requireValue(
		typeof version === "string" && /^\d+(\.\d+\.\d+)?$/.test(version),
		"Node version must be a major, exact version, or null"
	);
	requireValue(
		version === process.versions.node ||
			version === process.versions.node.split(".")[0],
		`Expected Node ${version}, found ${process.versions.node}; runtime: ${process.execPath}`
	);
}
/** @type {(value: unknown, keys: string[], label: string) => asserts value is Record<string, unknown>} */
function object(value, keys, label) {
	requireValue(
		value !== null && typeof value === "object" && !Array.isArray(value),
		`${label} must be an object`
	);
	requireValue(
		Object.keys(value).every((key) => keys.includes(key)),
		`${label} has an unknown field`
	);
}
/** @type {(value: unknown, label: string) => asserts value is string[]} */
function strings(value, label) {
	requireValue(
		Array.isArray(value) &&
			value.every(
				(entry) =>
					typeof entry === "string" && entry.length > 0 && !entry.includes("\0")
			),
		`${label} must be an array of non-empty strings`
	);
	requireValue(new Set(value).size === value.length, `${label} has duplicates`);
}
/** @type {(value: unknown, label: string) => asserts value is string} */
function relativePath(value, label) {
	requireValue(
		typeof value === "string" &&
			value.length > 0 &&
			!value.includes("\0") &&
			!value.includes("\\") &&
			!path.posix.isAbsolute(value) &&
			!path.win32.isAbsolute(value) &&
			!value.includes(":"),
		`${label} must be a portable relative path`
	);
	requireValue(
		value.split("/").every((segment) => segment !== ".." && segment !== ""),
		`${label} escapes its repository`
	);
}

/** Validate data without evaluating project code or config. @type {(input: unknown) => Manifest} */
export function validateManifest(input) {
	object(
		input,
		[
			"schemaVersion",
			"project",
			"root",
			"source",
			"verification",
			"notes",
			"components",
		],
		"manifest"
	);
	requireValue(input.schemaVersion === 1, "Unsupported schemaVersion");
	requireValue(
		typeof input.project === "string" && PROJECTS.includes(input.project),
		"Unknown project"
	);
	relativePath(input.root, "root");
	object(input.source, ["repository", "commit"], "source");
	requireValue(
		input.source.repository === `https://github.com/cinagroup/${input.project}`,
		"Unexpected source repository"
	);
	requireValue(
		typeof input.source.commit === "string" &&
			/^[a-f0-9]{40}$/.test(input.source.commit),
		"source.commit must pin a full commit"
	);
	requireValue(
		input.verification === "configured-pending-validation",
		"Manifest configuration cannot claim execution success"
	);
	strings(input.notes, "notes");
	requireValue(
		Array.isArray(input.components) && input.components.length > 0,
		"components must not be empty"
	);
	const ids = new Set();
	const components = new Set();
	for (const component of input.components) {
		object(
			component,
			["component", "root", "toolchain", "credentialRefs", "tasks"],
			"component"
		);
		requireValue(
			typeof component.component === "string" &&
				/^[a-z][a-z0-9-]*$/.test(component.component) &&
				!components.has(component.component),
			"Invalid or duplicate component"
		);
		components.add(component.component);
		relativePath(component.root, "component.root");
		object(
			component.toolchain,
			["name", "version", "lockfile", "nodeVersion"],
			"toolchain"
		);
		requireValue(
			["npm", "pnpm", "node", "forge"].includes(
				String(component.toolchain.name)
			),
			"Unknown toolchain"
		);
		requireValue(
			component.toolchain.version === null ||
				(typeof component.toolchain.version === "string" &&
					/^\d+(\.\d+\.\d+)?$/.test(component.toolchain.version)),
			"Toolchain version must be a major, exact version, or null"
		);
		requireValue(
			component.toolchain.nodeVersion === undefined ||
				component.toolchain.nodeVersion === null ||
				(typeof component.toolchain.nodeVersion === "string" &&
					/^\d+(\.\d+\.\d+)?$/.test(component.toolchain.nodeVersion)),
			"Node version must be a major, exact version, or null"
		);
		if (component.toolchain.lockfile !== null) {
			relativePath(component.toolchain.lockfile, "toolchain.lockfile");
		}
		strings(component.credentialRefs, "credentialRefs");
		requireValue(
			component.credentialRefs.every((ref) =>
				/^env:[A-Z][A-Z0-9_]*$/.test(ref)
			),
			"Credentials must be references, never values"
		);
		requireValue(Array.isArray(component.tasks), "tasks must be an array");
		for (const task of component.tasks) {
			object(
				task,
				[
					"task",
					"capability",
					"argv",
					"cwd",
					"dependencies",
					"outputs",
					"effects",
					"timeoutMs",
					"script",
				],
				"task"
			);
			requireValue(
				typeof task.task === "string" && /^[a-z][a-z0-9-]*$/.test(task.task),
				"Invalid task identifier"
			);
			const id = `${component.component}/${task.task}`;
			requireValue(!ids.has(id), `Duplicate task ${id}`);
			ids.add(id);
			requireValue(
				["check", "build", "test", "deploy"].includes(String(task.capability)),
				"Unknown capability"
			);
			requireValue(
				Array.isArray(task.argv) &&
					task.argv.every(
						(arg) =>
							typeof arg === "string" && arg.length > 0 && !arg.includes("\0")
					),
				"argv must be an array of non-empty strings"
			);
			requireValue(
				task.argv.length > 0 && task.argv[0] === component.toolchain.name,
				"argv must use its declared toolchain"
			);
			if (["npm", "pnpm"].includes(String(component.toolchain.name))) {
				requireValue(
					(task.argv.length === 3 ||
						(component.toolchain.name === "npm" &&
							task.argv.length >= 5 &&
							task.argv[3] === "--")) &&
						task.argv[1] === "run" &&
						/^[\w:][\w:-]*$/.test(task.argv[2] ?? ""),
					"Only explicit package scripts are supported"
				);
				requireValue(
					typeof task.script === "string" && task.script.length > 0,
					"Package scripts must pin their current command"
				);
			} else {
				requireValue(
					task.script === undefined,
					"script is only valid for package-manager tasks"
				);
			}
			relativePath(task.cwd, "task.cwd");
			const componentRoot = path.posix.normalize(component.root);
			const taskCwd = path.posix.normalize(task.cwd);
			requireValue(
				componentRoot === "." ||
					taskCwd === componentRoot ||
					taskCwd.startsWith(`${componentRoot}/`),
				"cwd must be inside its component"
			);
			strings(task.dependencies, "dependencies");
			strings(task.outputs, "outputs");
			for (const output of task.outputs) {
				relativePath(output, "output");
			}
			strings(task.effects, "effects");
			requireValue(
				task.effects.length > 0 &&
					task.effects.every((effect) =>
						[
							"local-read",
							"local-write",
							"network-read",
							"remote-write",
						].includes(effect)
					),
				"Unknown or empty effects"
			);
			requireValue(
				task.outputs.length === 0 || task.effects.includes("local-write"),
				"Outputs require a declared local-write effect"
			);
			requireValue(
				typeof task.timeoutMs === "number" &&
					Number.isInteger(task.timeoutMs) &&
					task.timeoutMs >= 1 &&
					task.timeoutMs <= 3600000,
				"timeoutMs must be 1..3600000"
			);
		}
	}
	const manifest = /** @type {Manifest} */ (/** @type {unknown} */ (input));
	orderTasks(flattenTasks(manifest));
	return manifest;
}

/** @type {(manifest: Manifest) => PlannedTask[]} */
export function flattenTasks(manifest) {
	return manifest.components.flatMap((component) =>
		component.tasks.map((task) => ({
			...task,
			id: `${component.component}/${task.task}`,
			component: component.component,
			toolchain: component.toolchain,
		}))
	);
}

/** @type {(tasks: PlannedTask[]) => PlannedTask[]} */
export function orderTasks(tasks) {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	/** @type {Set<string>} */ const visiting = new Set();
	/** @type {Set<string>} */ const visited = new Set();
	/** @type {PlannedTask[]} */ const ordered = [];
	/** @type {(task: PlannedTask) => void} */
	function visit(task) {
		requireValue(!visiting.has(task.id), `Dependency cycle at ${task.id}`);
		if (visited.has(task.id)) {
			return;
		}
		visiting.add(task.id);
		for (const id of task.dependencies) {
			const dependency = byId.get(id);
			requireValue(dependency, `Unknown dependency ${id}`);
			visit(dependency);
		}
		visiting.delete(task.id);
		visited.add(task.id);
		ordered.push(task);
	}
	for (const task of tasks) {
		visit(task);
	}
	return ordered;
}

/** Resolve existing or future paths while checking every symlink ancestor. @type {(repoRoot: string, relative: string, mustExist?: boolean) => string} */
export function containedPath(repoRoot, relative, mustExist = true) {
	relativePath(relative, "path");
	const root = realpathSync(repoRoot);
	const target = path.resolve(root, relative);
	let ancestor = target;
	while (true) {
		try {
			lstatSync(ancestor);
			break;
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			) {
				throw error;
			}
			const parent = path.dirname(ancestor);
			requireValue(parent !== ancestor, "No existing path ancestor");
			ancestor = parent;
		}
	}
	const real = realpathSync(ancestor);
	const offset = path.relative(root, real);
	requireValue(
		offset !== ".." &&
			!offset.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(offset),
		`Path crosses repository boundary: ${relative}`
	);
	requireValue(!mustExist || existsSync(target), `Missing path: ${relative}`);
	return target;
}

/** @type {(repoRoot: string) => string} */
export function repositoryRoot(repoRoot) {
	const root = realpathSync(repoRoot);
	requireValue(
		statSync(root).isDirectory() && existsSync(path.join(root, ".git")),
		"--repo must name a Git repository root"
	);
	return root;
}

/** @type {(project: string, repoRoot?: string) => Manifest} */
export function loadManifest(project, repoRoot) {
	requireValue(PROJECTS.includes(project), "Unknown project");
	let filename = fileURLToPath(
		new URL(`../catalog/${project}.json`, import.meta.url)
	);
	if (repoRoot && existsSync(path.join(repoRoot, "cina.project.json"))) {
		filename = containedPath(repositoryRoot(repoRoot), "cina.project.json");
	}
	const manifest = validateManifest(JSON.parse(readFileSync(filename, "utf8")));
	requireValue(
		manifest.project === project,
		"Manifest project does not match --project"
	);
	return manifest;
}

/** @type {(manifest: Manifest, root: string, capability: string, componentName?: string) => Plan} */
export function createPlan(manifest, root, capability, componentName) {
	requireValue(
		["check", "build", "test", "deploy"].includes(capability),
		"Unknown capability"
	);
	const repoRoot = repositoryRoot(root);
	containedPath(repoRoot, manifest.root);
	if (componentName) {
		requireValue(
			manifest.components.some((entry) => entry.component === componentName),
			"Unknown component"
		);
	}
	const all = flattenTasks(manifest);
	const selected = all.filter(
		(task) =>
			task.capability === capability &&
			(!componentName || task.component === componentName)
	);
	requireValue(
		selected.length > 0,
		`No declared ${capability} capability for ${manifest.project}`
	);
	const ids = new Set(selected.map((task) => task.id));
	/** @type {(task: PlannedTask) => void} */
	function includeDependencies(task) {
		for (const id of task.dependencies) {
			const dependency = all.find((entry) => entry.id === id);
			requireValue(dependency, `Unknown dependency ${id}`);
			if (!ids.has(id)) {
				ids.add(id);
				includeDependencies(dependency);
			}
		}
	}
	for (const task of selected) {
		includeDependencies(task);
	}
	const tasks = orderTasks(all.filter((task) => ids.has(task.id))).map(
		(task) => {
			assertNodeVersion(task.toolchain.nodeVersion);
			const component = manifest.components.find(
				(entry) => entry.component === task.component
			);
			requireValue(component, "Unknown component");
			containedPath(repoRoot, component.root);
			if (task.toolchain.lockfile) {
				containedPath(repoRoot, task.toolchain.lockfile);
			}
			const cwd = containedPath(repoRoot, task.cwd);
			requireValue(statSync(cwd).isDirectory(), "cwd must be a directory");
			for (const output of task.outputs) {
				containedPath(repoRoot, output, false);
			}
			if (task.script !== undefined) {
				const packageFile = containedPath(
					repoRoot,
					`${task.cwd === "." ? "" : `${task.cwd}/`}package.json`
				);
				const pkg = JSON.parse(readFileSync(packageFile, "utf8"));
				requireValue(
					pkg.scripts?.[task.argv[2] ?? ""] === task.script,
					`Script drift for ${task.id}; review the manifest before running`
				);
				requireValue(
					!pkg.scripts?.[`pre${task.argv[2]}`] &&
						!pkg.scripts?.[`post${task.argv[2]}`],
					`Undeclared lifecycle hook for ${task.id}; pre/post scripts require separate review`
				);
				if (pkg.packageManager) {
					const declared = String(pkg.packageManager).split("@");
					requireValue(
						declared[0] === task.toolchain.name,
						`Package manager mismatch for ${task.id}`
					);
					const version = declared[1]?.split("+")[0];
					if (task.toolchain.version) {
						requireValue(
							version === task.toolchain.version ||
								version?.split(".")[0] === task.toolchain.version,
							`Pinned toolchain mismatch for ${task.id}`
						);
					}
				}
			}
			return { ...task, cwd };
		}
	);
	return {
		project: manifest.project,
		repoRoot,
		source: manifest.source,
		verification: manifest.verification,
		tasks,
		effects: [...new Set(tasks.flatMap((task) => task.effects))],
	};
}
