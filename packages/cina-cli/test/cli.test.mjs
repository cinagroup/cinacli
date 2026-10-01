import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROJECTS } from "../src/manifest.mjs";

/** @typedef {import('node:test').TestContext} TestContext */
/** @typedef {import('../src/manifest.mjs').Manifest} Manifest */

const SOURCE = fileURLToPath(new URL("../src/", import.meta.url));

// The subprocess may read metadata, but any attempted process, network or
// filesystem mutation makes the command fail. The parent creates fixtures
// before these guards load and compares their complete contents afterwards.
const READ_ONLY_GUARD = `
import childProcess from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
function forbidden() { throw new Error("READ_ONLY_VIOLATION"); }
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[method] = forbidden;
for (const method of ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "mkdir", "mkdirSync", "rename", "renameSync", "rm", "rmSync", "rmdir", "rmdirSync", "unlink", "unlinkSync", "copyFile", "copyFileSync", "symlink", "symlinkSync", "createWriteStream"]) fs[method] = forbidden;
for (const method of ["writeFile", "appendFile", "mkdir", "rename", "rm", "rmdir", "unlink", "copyFile", "symlink"]) fsPromises[method] = forbidden;
http.request = http.get = https.request = https.get = forbidden;
globalThis.fetch = forbidden;
syncBuiltinESMExports();
`;

/** @type {() => Manifest} */
function manifest() {
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
				toolchain: { name: "node", version: null, lockfile: null },
				credentialRefs: ["env:CINA_TEST_TOKEN"],
				tasks: [
					{
						task: "check",
						capability: "check",
						argv: ["node", "never-execute.mjs"],
						cwd: ".",
						dependencies: [],
						outputs: ["artifact"],
						effects: ["local-write"],
						timeoutMs: 1000,
					},
				],
			},
		],
	};
}

/** @type {(t: TestContext, includeRunner?: boolean) => {temporary: string, cli: string, repo: string, guard: string}} */
function fixture(t, includeRunner = false) {
	const temporary = mkdtempSync(path.join(tmpdir(), "cina-cli-test-"));
	const cli = path.join(temporary, "cli");
	const repo = path.join(temporary, "repo");
	mkdirSync(path.join(cli, "src"), { recursive: true });
	mkdirSync(path.join(repo, ".git"), { recursive: true });
	for (const filename of ["index.mjs", "manifest.mjs", "dev.mjs"]) {
		copyFileSync(path.join(SOURCE, filename), path.join(cli, "src", filename));
	}
	if (includeRunner) {
		copyFileSync(
			path.join(SOURCE, "runner.mjs"),
			path.join(cli, "src", "runner.mjs")
		);
	} else {
		writeFileSync(
			path.join(cli, "src", "runner.mjs"),
			'throw new Error("Runner must remain lazy");\n'
		);
	}
	writeFileSync(
		path.join(cli, "package.json"),
		JSON.stringify({ type: "module", name: "@cinagroup/cli", version: "0.1.0" })
	);
	const guard = path.join(temporary, "read-only-guard.mjs");
	writeFileSync(guard, READ_ONLY_GUARD);
	writeFileSync(
		path.join(repo, "cina.project.json"),
		JSON.stringify(manifest())
	);
	const dangerous =
		'import { writeFileSync } from "node:fs"; writeFileSync("executed.txt", "executed"); throw new Error("Must never execute");\n';
	writeFileSync(path.join(repo, "cloudflare.config.ts"), dangerous);
	writeFileSync(path.join(repo, "never-execute.mjs"), dangerous);
	t.after(() => rmSync(temporary, { recursive: true, force: true }));
	return { temporary, cli, repo, guard };
}

/** @type {(fixtureData: ReturnType<typeof fixture>, argv: string[]) => import("node:child_process").SpawnSyncReturns<string>} */
function invoke(fixtureData, argv) {
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			pathToFileURL(fixtureData.guard).href,
			path.join(fixtureData.cli, "src", "dev.mjs"),
			...argv,
		],
		{
			cwd: fixtureData.repo,
			encoding: "utf8",
			timeout: 10000,
			windowsHide: true,
			env: {
				...process.env,
				HOME: path.join(fixtureData.temporary, "user-home"),
				USERPROFILE: path.join(fixtureData.temporary, "user-home"),
				XDG_CONFIG_HOME: path.join(fixtureData.temporary, "user-config"),
				CINA_TEST_TOKEN: "must-never-be-resolved-or-printed",
			},
		}
	);
	assert.ifError(result.error);
	assert.equal(result.signal, null, result.stderr);
	assert.doesNotMatch(
		result.stdout + result.stderr,
		/must-never-be-resolved-or-printed/
	);
	return result;
}

/** @type {(directory: string) => string[]} */
function snapshot(directory) {
	/** @type {string[]} */
	const entries = [];
	/** @type {(current: string) => void} */
	function visit(current) {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const filename = path.join(current, entry.name);
			const relative = path.relative(directory, filename);
			if (entry.isDirectory()) {
				entries.push(`${relative}/`);
				visit(filename);
			} else {
				entries.push(
					`${relative}:${createHash("sha256").update(readFileSync(filename)).digest("hex")}`
				);
			}
		}
	}
	visit(directory);
	return entries.sort();
}

await test("help starts with no catalog, no runner, no SDK and no persistent state", (t) => {
	const data = fixture(t);
	assert.equal(existsSync(path.join(data.cli, "catalog")), false);
	const before = snapshot(data.temporary);
	for (const argv of [[], ["--help"], ["-h"], ["help"]]) {
		const result = invoke(data, argv);
		assert.equal(result.status, 0, result.stderr);
		assert.match(
			result.stdout,
			/local engineering tasks for seven Cina projects/
		);
		assert.equal(result.stderr, "");
	}
	assert.deepEqual(snapshot(data.temporary), before);
});

await test("inspect lists exactly seven projects and keeps configuration distinct from execution", () => {
	const result = spawnSync(
		process.execPath,
		[path.join(SOURCE, "dev.mjs"), "inspect"],
		{ encoding: "utf8", timeout: 10000, windowsHide: true }
	);
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	/** @type {{schemaVersion: number, projects: {project: string, verification: string}[]}} */
	const output = JSON.parse(result.stdout);
	assert.equal(output.schemaVersion, 1);
	assert.deepEqual(
		output.projects.map((entry) => entry.project),
		[...PROJECTS]
	);
	assert.ok(
		output.projects.every(
			(entry) => entry.verification === "configured-pending-validation"
		)
	);
});

await test("plan is stateless, does not import the runner and never evaluates scripts or TS config", (t) => {
	const data = fixture(t);
	const before = snapshot(data.temporary);
	const result = invoke(data, [
		"plan",
		"check",
		"--project",
		"cinagroup",
		"--repo",
		data.repo,
	]);
	assert.equal(result.status, 0, result.stderr);
	/** @type {{verification: string, tasks: {id: string, effects: string[]}[]}} */
	const output = JSON.parse(result.stdout);
	assert.equal(output.verification, "configured-pending-validation");
	assert.deepEqual(
		output.tasks.map((task) => task.id),
		["site/check"]
	);
	assert.deepEqual(output.tasks[0]?.effects, ["local-write"]);
	assert.equal(result.stderr, "");
	assert.deepEqual(snapshot(data.temporary), before);
});

await test("doctor resolves tools only from static metadata without spawning, writing or networking", (t) => {
	const data = fixture(t, true);
	const before = snapshot(data.temporary);
	const result = invoke(data, [
		"doctor",
		"--project",
		"cinagroup",
		"--repo",
		data.repo,
	]);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	/** @type {{status: string, verification: string, checks: {ok: boolean, tool: {name: string, available: boolean}}[]}} */
	const output = JSON.parse(result.stdout);
	assert.equal(output.status, "ready");
	assert.equal(output.verification, "configured-pending-validation");
	assert.equal(output.checks[0]?.ok, true);
	assert.equal(output.checks[0]?.tool.name, "node");
	assert.equal(output.checks[0]?.tool.available, true);
	assert.equal(result.stderr, "");
	assert.deepEqual(snapshot(data.temporary), before);
});

await test("invalid CLI commands use structured exit 2 and cannot fall back to cf", (t) => {
	const data = fixture(t);
	const before = snapshot(data.temporary);
	/** @type {string[][]} */
	const commands = [
		["deploy"],
		["plan", "check"],
		["inspect", "--repo", data.repo],
		["inspect", "--project", "unknown"],
		[
			"doctor",
			"--project",
			"cinagroup",
			"--repo",
			data.repo,
			"--allow-local-write",
		],
		["plan", "deploy", "--project", "cinagroup", "--repo", data.repo],
		[
			"plan",
			"check",
			"--project",
			"cinagroup",
			"--project",
			"cinagroup",
			"--repo",
			data.repo,
		],
		[
			"plan",
			"check",
			"--project",
			"cinagroup",
			"--repo",
			data.repo,
			"--remote",
		],
	];
	for (const argv of commands) {
		const result = invoke(data, argv);
		assert.equal(result.status, 2, result.stdout + result.stderr);
		/** @type {{status: string, exitCode: number, error: string}} */
		const output = JSON.parse(result.stdout);
		assert.equal(output.status, "invalid");
		assert.equal(output.exitCode, 2);
		assert.ok(output.error);
		assert.equal(result.stderr, "");
	}
	assert.deepEqual(snapshot(data.temporary), before);
});
