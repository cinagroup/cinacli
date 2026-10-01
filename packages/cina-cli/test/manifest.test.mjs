import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	PROJECTS,
	containedPath,
	createPlan,
	flattenTasks,
	loadManifest,
	repositoryRoot,
	validateManifest,
} from "../src/manifest.mjs";

/** @typedef {import('../src/manifest.mjs').Manifest} Manifest */
/** @typedef {import('../src/manifest.mjs').Task} Task */
/** @typedef {import('node:test').TestContext} TestContext */

/** @type {() => Manifest} */
function example() {
	return {
		schemaVersion: 1,
		project: "cinagroup",
		root: ".",
		source: {
			repository: "https://github.com/cinagroup/cinagroup",
			commit: "a".repeat(40),
		},
		verification: "configured-pending-validation",
		notes: [],
		components: [
			{
				component: "site",
				root: ".",
				toolchain: {
					name: "npm",
					version: "11",
					lockfile: "package-lock.json",
				},
				credentialRefs: [],
				tasks: [
					{
						task: "build",
						capability: "build",
						argv: ["npm", "run", "build"],
						cwd: ".",
						dependencies: ["site/check"],
						outputs: ["dist"],
						effects: ["local-write"],
						timeoutMs: 1000,
						script: "node build.mjs",
					},
					{
						task: "check",
						capability: "check",
						argv: ["npm", "run", "check"],
						cwd: ".",
						dependencies: [],
						outputs: [],
						effects: ["local-read"],
						timeoutMs: 1000,
						script: "node check.mjs",
					},
				],
			},
		],
	};
}

/** @type {(manifest: Manifest) => import("../src/manifest.mjs").Component} */
function firstComponent(manifest) {
	const component = manifest.components[0];
	assert.ok(component);
	return component;
}

/** @type {(manifest: Manifest) => Task} */
function firstTask(manifest) {
	const task = firstComponent(manifest).tasks[0];
	assert.ok(task);
	return task;
}

/** @type {(t: TestContext) => {root: string, temporary: string}} */
function fixture(t) {
	const temporary = mkdtempSync(path.join(tmpdir(), "cina-manifest-test-"));
	const root = path.join(temporary, "repo");
	mkdirSync(path.join(root, ".git"), { recursive: true });
	writeFileSync(path.join(root, "package-lock.json"), "{}\n");
	writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({
			packageManager: "npm@11.0.0",
			scripts: { build: "node build.mjs", check: "node check.mjs" },
		})
	);
	t.after(() => rmSync(temporary, { recursive: true, force: true }));
	return { root, temporary };
}

await test("the static catalog identifies exactly seven configured projects", () => {
	assert.deepEqual([...PROJECTS].sort(), [
		"cinaauth",
		"cinachain",
		"cinaclassics",
		"cinagroup",
		"cinaseek",
		"cinashop",
		"cinatoken",
	]);
	for (const project of PROJECTS) {
		const manifest = loadManifest(project);
		assert.equal(manifest.project, project);
		assert.equal(manifest.verification, "configured-pending-validation");
		assert.match(manifest.source.commit, /^[a-f0-9]{40}$/);
		assert.ok(manifest.components.length > 0);
		assert.ok(
			flattenTasks(manifest).every((task) => task.capability !== "deploy")
		);
	}
});

await test("focused Token and Auth plans do not require aggregate or sibling scripts", (t) => {
	const { root } = fixture(t);
	/** @type {Array<[string, string]>} */ const scopes = [
		["cinatoken", "tool-engines"],
		["cinaauth", "packages-auth-proxy"],
	];
	for (const [project, componentName] of scopes) {
		const manifest = loadManifest(project);
		const component = manifest.components.find(
			(entry) => entry.component === componentName
		);
		assert.ok(component);
		assert.ok(component.tasks.length > 0);
		mkdirSync(path.join(root, component.root), { recursive: true });
		writeFileSync(
			path.join(root, component.root, "package.json"),
			JSON.stringify({
				scripts: Object.fromEntries(
					component.tasks.map((task) => [task.argv[2], task.script])
				),
			})
		);
		writeFileSync(
			path.join(root, component.toolchain.lockfile ?? "lock"),
			"{}\n"
		);
		for (const capability of new Set(
			component.tasks.map((task) => task.capability)
		)) {
			const plan = createPlan(manifest, root, capability, componentName);
			assert.ok(plan.tasks.length > 0);
			assert.ok(
				plan.tasks.every(
					(task) =>
						task.component === componentName && task.dependencies.length === 0
				)
			);
			assert.deepEqual(plan.effects, ["local-write"]);
		}
	}
});

await test("manifest rejects schema, project, source and premature success claims", () => {
	/** @type {Array<[string, unknown]>} */
	const cases = [
		["schemaVersion", 2],
		["project", "unknown"],
		["verification", "verified"],
	];
	for (const [field, value] of cases) {
		const input = { ...example(), [field]: value };
		assert.throws(() => validateManifest(input));
	}
	assert.throws(
		() =>
			validateManifest({
				...example(),
				source: { repository: "https://example.com", commit: "a".repeat(40) },
			}),
		/source repository/
	);
	assert.throws(
		() =>
			validateManifest({
				...example(),
				source: { repository: example().source.repository, commit: "abc123" },
			}),
		/full commit/
	);
});

await test("unknown fields and credential values fail closed at every object boundary", () => {
	/** @type {Array<(manifest: Manifest) => object>} */
	const targets = [
		(manifest) => manifest,
		(manifest) => manifest.source,
		firstComponent,
		(manifest) => firstComponent(manifest).toolchain,
		firstTask,
	];
	for (const target of targets) {
		const manifest = example();
		Object.assign(target(manifest), { unexpected: true });
		assert.throws(() => validateManifest(manifest), /unknown field/);
	}
	const manifest = example();
	firstComponent(manifest).credentialRefs = ["env:CINA_API_TOKEN"];
	assert.equal(validateManifest(manifest), manifest);
	for (const reference of [
		"literal-secret-value",
		"env:lowercase",
		"env:TOKEN=secret",
	]) {
		firstComponent(manifest).credentialRefs = [reference];
		assert.throws(() => validateManifest(manifest), /references, never values/);
	}
});

await test("capabilities, effects and argv must be explicit and valid", () => {
	/** @type {Array<[string, unknown]>} */
	const cases = [
		["capability", "publish"],
		["argv", []],
		["argv", ["npm", "run", ""]],
		["argv", ["npm", "run", "build\0"]],
		["argv", ["cf", "deploy"]],
		["argv", ["npm", "exec", "build"]],
		["effects", []],
		["effects", ["unknown"]],
		["timeoutMs", 0],
		["timeoutMs", 3600001],
		["timeoutMs", 1.5],
	];
	for (const [field, value] of cases) {
		const manifest = example();
		Object.assign(firstTask(manifest), { [field]: value });
		assert.throws(() => validateManifest(manifest), field);
	}
	const manifest = example();
	firstTask(manifest).effects = ["local-read"];
	assert.throws(() => validateManifest(manifest), /Outputs require/);
	Object.assign(firstComponent(manifest).toolchain, { name: "yarn" });
	assert.throws(() => validateManifest(manifest), /Unknown toolchain/);
});

await test("argv preserves repeated arguments instead of treating it as a set", () => {
	const manifest = example();
	const component = firstComponent(manifest);
	component.toolchain = { name: "node", version: null, lockfile: null };
	for (const task of component.tasks) {
		task.argv = ["node", "check.mjs", "same", "same"];
		delete task.script;
	}
	assert.deepEqual(firstTask(validateManifest(manifest)).argv, [
		"node",
		"check.mjs",
		"same",
		"same",
	]);
});

await test("dependency graphs reject unknown nodes and cycles", () => {
	const manifest = example();
	firstTask(manifest).dependencies = ["site/missing"];
	assert.throws(() => validateManifest(manifest), /Unknown dependency/);
	const cycle = example();
	const check = firstComponent(cycle).tasks[1];
	assert.ok(check);
	check.dependencies = ["site/build"];
	assert.throws(() => validateManifest(cycle), /Dependency cycle/);
});

await test("portable paths reject parent, absolute and Windows escape forms", () => {
	for (const root of [
		"../other",
		"/other",
		"C:/other",
		"C:other",
		"tools\\other",
		"a//b",
		"a/../b",
	]) {
		assert.throws(() => validateManifest({ ...example(), root }), root);
	}
	const manifest = example();
	firstComponent(manifest).root = "web";
	firstTask(manifest).cwd = "web-extra";
	assert.throws(() => validateManifest(manifest), /inside its component/);
});

await test("plan orders dependencies, checks native script drift and refuses undeclared deploy", (t) => {
	const { root } = fixture(t);
	const plan = createPlan(validateManifest(example()), root, "build");
	assert.deepEqual(
		plan.tasks.map((task) => task.id),
		["site/check", "site/build"]
	);
	assert.ok(plan.tasks.every((task) => task.cwd === realpathSync(root)));
	assert.deepEqual(plan.effects, ["local-read", "local-write"]);
	assert.throws(
		() => createPlan(example(), root, "deploy"),
		/No declared deploy/
	);
	assert.throws(
		() => createPlan(example(), root, "build", "missing"),
		/Unknown component/
	);
	writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({
			scripts: { check: "node check.mjs", build: "npm publish" },
		})
	);
	assert.throws(() => createPlan(example(), root, "build"), /Script drift/);
});

await test("plan rejects undeclared pre/post hooks without executing them", (t) => {
	const { root } = fixture(t);
	const marker = path.join(root, "hook-executed.txt");
	writeFileSync(
		path.join(root, "never-execute-hook.mjs"),
		'import { writeFileSync } from "node:fs"; writeFileSync(' +
			JSON.stringify(marker) +
			', "executed"); throw new Error("Hook must never execute");'
	);
	for (const hook of ["precheck", "postcheck", "prebuild", "postbuild"]) {
		writeFileSync(
			path.join(root, "package.json"),
			JSON.stringify({
				packageManager: "npm@11.0.0",
				scripts: {
					check: "node check.mjs",
					build: "node build.mjs",
					[hook]: "node never-execute-hook.mjs",
				},
			})
		);
		assert.throws(
			() => createPlan(validateManifest(example()), root, "build"),
			/Undeclared lifecycle hook/,
			hook
		);
		assert.equal(existsSync(marker), false, hook);
		assert.equal(existsSync(path.join(root, "dist")), false, hook);
	}
});

await test("repository root must be explicit and local manifests must match the selected project", (t) => {
	const { root, temporary } = fixture(t);
	assert.equal(repositoryRoot(root), realpathSync(root));
	assert.throws(() => repositoryRoot(temporary), /Git repository root/);
	const manifest = example();
	manifest.project = "cinatoken";
	manifest.source.repository = "https://github.com/cinagroup/cinatoken";
	writeFileSync(path.join(root, "cina.project.json"), JSON.stringify(manifest));
	assert.throws(() => loadManifest("cinagroup", root), /does not match/);
});

await test("plan reads JSON without evaluating TypeScript config or repository scripts", (t) => {
	const { root } = fixture(t);
	const marker = path.join(root, "executed.txt");
	const dangerous = `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "executed"); throw new Error("Must never evaluate");`;
	writeFileSync(path.join(root, "cloudflare.config.ts"), dangerous);
	writeFileSync(path.join(root, "check.mjs"), dangerous);
	createPlan(validateManifest(example()), root, "build");
	assert.equal(existsSync(marker), false);
	assert.equal(existsSync(path.join(root, "dist")), false);
});

/** @type {(t: TestContext, target: string, link: string) => boolean} */
function linkDirectory(t, target, link) {
	try {
		symlinkSync(
			target,
			link,
			process.platform === "win32" ? "junction" : "dir"
		);
		return true;
	} catch (error) {
		const code = /** @type {NodeJS.ErrnoException} */ (error).code;
		if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
			t.skip(`Directory symlinks are unavailable: ${code}`);
			return false;
		}
		throw error;
	}
}

await test("existing paths and future output ancestors cannot traverse outside symlinks", (t) => {
	const { root, temporary } = fixture(t);
	const outside = path.join(temporary, "outside");
	mkdirSync(outside);
	if (!linkDirectory(t, outside, path.join(root, "external"))) {
		return;
	}
	assert.throws(() => containedPath(root, "external"), /repository boundary/);
	assert.throws(
		() => containedPath(root, "external/new/output", false),
		/repository boundary/
	);
	const manifest = example();
	firstTask(manifest).outputs = ["external/new/output"];
	assert.throws(
		() => createPlan(validateManifest(manifest), root, "build"),
		/repository boundary/
	);
});

await test("dangling output ancestor links fail closed before future writes", (t) => {
	const { root, temporary } = fixture(t);
	const missingOutside = path.join(temporary, "missing-outside");
	if (!linkDirectory(t, missingOutside, path.join(root, "dangling"))) {
		return;
	}
	assert.throws(() => containedPath(root, "dangling/output", false));
});

await test("the packaged schema is static Draft 2020-12 with explicit fields and seven projects", () => {
	const schema = JSON.parse(
		readFileSync(
			new URL("../cina.project.schema.json", import.meta.url),
			"utf8"
		)
	);
	assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
	assert.deepEqual(schema.properties.project.enum, [...PROJECTS]);
	assert.equal(schema.additionalProperties, false);
	assert.equal(schema.$defs.component.additionalProperties, false);
	assert.equal(schema.$defs.toolchain.additionalProperties, false);
	assert.equal(schema.$defs.task.additionalProperties, false);
	assert.ok(schema.required.includes("schemaVersion"));
	for (const field of [
		"task",
		"capability",
		"argv",
		"cwd",
		"dependencies",
		"outputs",
		"effects",
		"timeoutMs",
	]) {
		assert.ok(schema.$defs.task.required.includes(field));
	}
	assert.equal(schema.$defs.task.properties.argv.uniqueItems, undefined);
	assert.doesNotMatch(JSON.stringify(schema), /"\$ref":"https?:/);
	const relative = new RegExp(schema.$defs.relativePath.pattern);
	for (const allowed of [".", "Tools", "Tools/dist", "./dist"]) {
		assert.ok(relative.test(allowed), allowed);
	}
	for (const forbidden of [
		"../other",
		"/other",
		"C:/other",
		"C:other",
		"tools\\other",
		"a//b",
		"a/../b",
		"a/",
		"a\0b",
	]) {
		assert.equal(relative.test(forbidden), false, forbidden);
	}
	const version = new RegExp(
		schema.$defs.toolchain.properties.version.anyOf[1].pattern
	);
	assert.ok(version.test("11"));
	assert.ok(version.test("11.1.1"));
	assert.equal(version.test("11.1"), false);
	const npmRule = schema.$defs.component.allOf[0].then.properties.tasks.items;
	assert.ok(
		new RegExp(npmRule.properties.argv.prefixItems[2].pattern).test("check")
	);
});
