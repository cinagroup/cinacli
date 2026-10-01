/* oxlint-disable turbo/no-undeclared-env-vars -- Runtime environment isolation is intentionally exercised outside Turbo caching. */
import assert from "node:assert/strict";
import {
	mkdtemp,
	mkdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import test from "node:test";
import { resolveTool, runPlan } from "../src/runner.mjs";

/** @type {(callback: (root: string) => Promise<void>) => Promise<void>} */
async function fixture(callback) {
	const root = await mkdtemp(join(tmpdir(), "cina-runner-"));
	try {
		await callback(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** @type {(root: string, id: string, script: string, changes?: Partial<import("../src/runner.mjs").Task>) => import("../src/runner.mjs").Task} */
function task(root, id, script, changes = {}) {
	return {
		id: `root/${id}`,
		component: "root",
		capability: "test",
		cwd: root,
		argv: ["node", "-e", script],
		dependencies: [],
		outputs: [],
		effects: ["local-read"],
		timeoutMs: 5000,
		toolchain: {
			name: /** @type {const} */ ("node"),
			version: null,
			lockfile: null,
		},
		...changes,
	};
}

await test("node resolution is static and validates major/exact versions", async () => {
	const node = {
		name: /** @type {const} */ ("node"),
		version: process.versions.node,
		lockfile: null,
	};
	assert.equal((await resolveTool(node)).available, true);
	assert.equal(
		(
			await resolveTool({
				...node,
				version: process.versions.node.split(".")[0] ?? null,
			})
		).available,
		true
	);
	assert.equal(
		(await resolveTool({ ...node, version: "999" })).available,
		false
	);
	assert.equal(
		(await resolveTool({ ...node, version: ">=22" })).available,
		false
	);
	assert.equal(
		(await resolveTool({ name: "forge", version: null, lockfile: null }))
			.available,
		false
	);
});

await test("argv metacharacters remain literal and credential environment is removed", async () => {
	await fixture(async (root) => {
		const previous = {
			NODE_OPTIONS: process.env.NODE_OPTIONS,
			CINA_TEST_SECRET: process.env.CINA_TEST_SECRET,
			CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
			HOME: process.env.HOME,
			USERPROFILE: process.env.USERPROFILE,
			npm_config_registry: process.env.npm_config_registry,
		};
		Object.assign(process.env, {
			NODE_OPTIONS: "--invalid-cina-option",
			CINA_TEST_SECRET: "secret",
			CLOUDFLARE_API_TOKEN: "token",
			HOME: "credential-home",
			USERPROFILE: "credential-profile",
			npm_config_registry: "https://invalid.example",
		});
		let output = "";
		try {
			const args = [
				"literal & echo injected",
				"$(echo injected)",
				"`echo injected`",
				"space value",
				'"quoted"',
			];
			const script =
				"console.log(JSON.stringify({argv:process.argv.slice(1),env:process.env}))";
			const result = await runPlan(
				{
					project: "fixture",
					repoRoot: root,
					tasks: [
						task(root, "arguments", script, {
							argv: ["node", "-e", script, ...args],
						}),
					],
				},
				{
					onOutput: (_id, _stream, chunk) => {
						output += chunk;
					},
				}
			);
			assert.equal(result.status, "success");
			const data = JSON.parse(output);
			assert.deepEqual(data.argv, args);
			for (const key of Object.keys(previous)) {
				assert.equal(
					data.env[key],
					["HOME", "USERPROFILE"].includes(key) ? root : undefined
				);
			}
			assert.equal(data.env.WRANGLER_SEND_METRICS, "false");
			assert.equal(data.env.ASTRO_TELEMETRY_DISABLED, "1");
			assert.equal(data.env.NPM_CONFIG_OFFLINE, "true");
			assert.equal(
				data.env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS,
				undefined
			);
			assert.equal(data.env.COREPACK_ENABLE_NETWORK, "0");
		} finally {
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
		}
	});
});

await test("preflight is atomic and local outputs require authorization", async () => {
	await fixture(async (root) => {
		const output = join(root, "should-not-exist");
		const script = `require('node:fs').writeFileSync(${JSON.stringify(output)},'artifact')`;
		const result = await runPlan({
			project: "fixture",
			repoRoot: root,
			tasks: [
				task(root, "first", script),
				task(root, "write", script, { effects: ["local-write"] }),
			],
		});
		assert.equal(result.status, "invalid");
		assert.equal(result.exitCode, 2);
		assert.deepEqual(result.tasks, []);
		await assert.rejects(readFile(output), { code: "ENOENT" });
		const allowed = await runPlan(
			{
				project: "fixture",
				repoRoot: root,
				tasks: [
					task(root, "write", script, {
						effects: ["local-write"],
						outputs: ["should-not-exist"],
					}),
				],
			},
			{ allowLocalWrite: true }
		);
		assert.equal(allowed.status, "success");
		assert.equal(await readFile(output, "utf8"), "artifact");
	});
});

await test("network, remote, undeclared capabilities and downloads are rejected", async () => {
	await fixture(async (root) => {
		for (const changes of [
			{ effects: ["network-read"] },
			{ effects: ["remote-write"] },
			{ effects: ["unknown"] },
			{ capability: "deploy" },
			{ capability: "doctor" },
			{
				argv: ["npm", "install"],
				toolchain: {
					name: /** @type {const} */ ("npm"),
					version: null,
					lockfile: null,
				},
			},
			{
				argv: ["pnpm", "exec", "uninstalled"],
				toolchain: {
					name: /** @type {const} */ ("pnpm"),
					version: null,
					lockfile: null,
				},
			},
			{ argv: ["npx", "uninstalled"] },
			{ argv: ["node", "-e", "\0"] },
		]) {
			const result = await runPlan(
				{
					project: "fixture",
					repoRoot: root,
					tasks: [task(root, "rejected", "process.exit(99)", changes)],
				},
				{ allowLocalWrite: true }
			);
			assert.equal(result.status, "invalid");
			assert.deepEqual(result.tasks, []);
		}
	});
});

await test("outside paths, sibling prefixes and symlink escapes are refused", async () => {
	await fixture(async (root) => {
		const repo = join(root, "repo");
		const sibling = join(root, "repo-outside");
		await mkdir(repo);
		await mkdir(sibling);
		for (const cwd of [sibling, join(repo, ".."), "relative-path"]) {
			assert.equal(
				(
					await runPlan({
						project: "fixture",
						repoRoot: repo,
						tasks: [task(repo, "escape", "", { cwd })],
					})
				).status,
				"invalid"
			);
		}
		const link = join(repo, "link");
		await symlink(
			sibling,
			link,
			process.platform === "win32" ? "junction" : "dir"
		);
		assert.equal(
			(
				await runPlan({
					project: "fixture",
					repoRoot: repo,
					tasks: [task(repo, "link", "", { cwd: link })],
				})
			).status,
			"invalid"
		);
	});
});

await test("execution rechecks a symlink changed after preflight", async () => {
	await fixture(async (root) => {
		const repo = join(root, "repo");
		const inside = join(repo, "inside");
		const outside = join(root, "outside");
		await mkdir(inside, { recursive: true });
		await mkdir(outside);
		const link = join(repo, "link");
		await symlink(
			inside,
			link,
			process.platform === "win32" ? "junction" : "dir"
		);
		const script = `const fs=require('node:fs');fs.unlinkSync(${JSON.stringify(link)});fs.symlinkSync(${JSON.stringify(outside)},${JSON.stringify(link)},${JSON.stringify(process.platform === "win32" ? "junction" : "dir")})`;
		const result = await runPlan(
			{
				project: "fixture",
				repoRoot: repo,
				tasks: [
					task(repo, "swap", script, { effects: ["local-write"] }),
					task(repo, "victim", "process.exit(99)", { cwd: link }),
				],
			},
			{ allowLocalWrite: true }
		);
		assert.equal(result.status, "partial");
		assert.equal(result.tasks[1]?.status, "invalid");
		assert.match(result.tasks[1]?.error ?? "", /escapes repository root/);
	});
});

await test("dependency failures skip dependents while independent tasks continue", async () => {
	await fixture(async (root) => {
		const result = await runPlan({
			project: "fixture",
			repoRoot: root,
			tasks: [
				task(root, "dependent", "process.exit(99)", {
					dependencies: ["root/fail"],
				}),
				task(root, "fail", "process.exit(7)"),
				task(root, "independent", "process.exit(0)"),
			],
		});
		assert.equal(result.status, "partial");
		assert.equal(result.exitCode, 1);
		assert.deepEqual(
			result.tasks.map(({ id, status, exitCode }) => ({
				id,
				status,
				exitCode,
			})),
			[
				{ id: "root/fail", status: "failed", exitCode: 7 },
				{ id: "root/independent", status: "success", exitCode: 0 },
				{ id: "root/dependent", status: "skipped", exitCode: null },
			]
		);
	});
});

await test("dependency cycles, unknown dependencies and duplicate IDs are rejected", async () => {
	await fixture(async (root) => {
		for (const tasks of [
			[
				task(root, "a", "", { dependencies: ["root/b"] }),
				task(root, "b", "", { dependencies: ["root/a"] }),
			],
			[task(root, "a", "", { dependencies: ["root/missing"] })],
			[task(root, "a", ""), task(root, "a", "")],
		]) {
			assert.equal(
				(await runPlan({ project: "fixture", repoRoot: root, tasks })).status,
				"invalid"
			);
		}
	});
});

/** @type {(pid: number) => boolean} */
function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const treeScript =
	"const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000)";

await test("timeout kills the complete process tree", async () => {
	await fixture(async (root) => {
		let output = "";
		const result = await runPlan(
			{
				project: "fixture",
				repoRoot: root,
				tasks: [task(root, "timeout", treeScript, { timeoutMs: 600 })],
			},
			{
				onOutput: (_id, _stream, chunk) => {
					output += chunk;
				},
			}
		);
		const pid = Number(output.trim());
		assert.ok(pid > 0, "child fixture must have started");
		assert.equal(result.status, "timeout");
		assert.equal(result.exitCode, 124);
		assert.equal(result.tasks[0]?.status, "timeout");
		assert.equal(result.tasks[0]?.error, undefined);
		assert.equal(isAlive(pid), false, `orphan child ${pid} remains`);
	});
});

await test("cancellation kills the tree and prevents later tasks from starting", async () => {
	await fixture(async (root) => {
		const controller = new AbortController();
		let output = "";
		const result = await runPlan(
			{
				project: "fixture",
				repoRoot: root,
				tasks: [
					task(root, "cancel", treeScript),
					task(root, "later", "process.exit(99)"),
				],
			},
			{
				signal: controller.signal,
				onOutput: (_id, _stream, chunk) => {
					output += chunk;
					controller.abort();
				},
			}
		);
		assert.equal(result.status, "cancelled");
		assert.equal(result.exitCode, 130);
		assert.equal(result.tasks[0]?.error, undefined);
		assert.deepEqual(
			result.tasks.map(({ status }) => status),
			["cancelled", "cancelled"]
		);
		assert.equal(isAlive(Number(output.trim())), false);
		const early = new AbortController();
		early.abort();
		assert.equal(
			(
				await runPlan(
					{
						project: "fixture",
						repoRoot: root,
						tasks: [task(root, "early", "process.exit(99)")],
					},
					{ signal: early.signal }
				)
			).status,
			"cancelled"
		);
	});
});

await test("installed pnpm metadata resolves without executing its shell shim", async () => {
	await fixture(async (root) => {
		const install = join(root, "tool-install");
		const bin = join(install, "node_modules", "pnpm", "bin");
		await mkdir(bin, { recursive: true });
		await writeFile(
			join(bin, "pnpm.cjs"),
			"console.log(JSON.stringify(process.argv.slice(2)))"
		);
		await writeFile(
			join(install, "node_modules", "pnpm", "package.json"),
			JSON.stringify({
				name: "pnpm",
				version: "11.1.0",
				bin: { pnpm: "bin/pnpm.cjs" },
			})
		);
		await writeFile(
			join(install, process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
			process.platform === "win32"
				? '"%dp0%\\node_modules\\pnpm\\bin\\pnpm.cjs" %*'
				: 'exec node "$basedir/node_modules/pnpm/bin/pnpm.cjs" "$@"'
		);
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ scripts: { check: "node check.cjs" } })
		);
		const previous = process.env.PATH;
		process.env.PATH = install;
		try {
			const resolved = await resolveTool({
				name: "pnpm",
				version: "11",
				lockfile: "pnpm-lock.yaml",
			});
			assert.equal(resolved.available, true);
			assert.equal(resolved.version, "11.1.0");
			assert.match(resolved.args[0] ?? "", /pnpm\.cjs$/);
			assert.equal(
				(await resolveTool({ name: "pnpm", version: "10", lockfile: null }))
					.available,
				false
			);
			let output = "";
			const result = await runPlan(
				{
					project: "fixture",
					repoRoot: root,
					tasks: [
						task(root, "pnpm", "", {
							argv: ["pnpm", "run", "check"],
							effects: ["local-write"],
							toolchain: {
								name: "pnpm",
								version: "11.1.0",
								lockfile: "pnpm-lock.yaml",
							},
						}),
					],
				},
				{
					allowLocalWrite: true,
					onOutput: (_id, _stream, chunk) => {
						output += chunk;
					},
				}
			);
			assert.equal(result.status, "success");
			assert.deepEqual(JSON.parse(output), ["run", "check"]);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

await test("Corepack/download proxies without package metadata do not resolve", async () => {
	await fixture(async (root) => {
		await writeFile(
			join(root, process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
			"node corepack/dist/pnpm.js"
		);
		const previous = process.env.PATH;
		process.env.PATH = root;
		try {
			const result = await resolveTool({
				name: "pnpm",
				version: null,
				lockfile: null,
			});
			assert.equal(result.available, false);
			assert.match(result.error ?? "", /install is never automatic/);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

/** @type {(root: string, version: string) => Promise<{root: string, entry: string, metadata: {name: string, version: string, os: string[], cpu: string[], publishConfig: {executableFiles: string[]}}}>} */
async function nativeFixture(root, version) {
	const filename = process.platform === "win32" ? "pnpm.exe" : "pnpm";
	const metadata = {
		name: `@pnpm/exe.${process.platform}-${process.arch}`,
		version,
		os: [process.platform],
		cpu: [process.arch],
		publishConfig: { executableFiles: [`./${filename}`] },
	};
	await mkdir(root, { recursive: true });
	await writeFile(join(root, "package.json"), JSON.stringify(metadata));
	const header =
		process.platform === "win32"
			? [0x4d, 0x5a, 0, 0]
			: process.platform === "darwin"
				? [0xfe, 0xed, 0xfa, 0xcf]
				: [0x7f, 0x45, 0x4c, 0x46];
	const entry = join(root, filename);
	// An incomplete binary deliberately proves resolution never runs --version.
	await writeFile(entry, Buffer.from(header));
	return { root, entry, metadata };
}

await test("native pnpm 11/12 resolves statically and chooses an installed matching version", async () => {
	await fixture(async (root) => {
		const twelve = await nativeFixture(join(root, "twelve"), "12.6.0");
		const eleven = await nativeFixture(join(root, "eleven"), "11.1.1");
		const previous = process.env.PATH;
		process.env.PATH = `${twelve.root}${delimiter}${eleven.root}`;
		try {
			for (const [version, expected] of [
				["12.6.0", twelve],
				["12", twelve],
				["11.1.1", eleven],
				["11", eleven],
			]) {
				const resolved = await resolveTool({
					name: "pnpm",
					version: /** @type {string} */ (version),
					lockfile: "pnpm-lock.yaml",
				});
				assert.equal(resolved.available, true);
				assert.equal(
					resolved.command,
					/** @type {typeof twelve} */ (expected).entry
				);
				assert.deepEqual(resolved.args, []);
			}
			const mismatch = await resolveTool({
				name: "pnpm",
				version: "11.1.2",
				lockfile: null,
			});
			assert.equal(mismatch.available, false);
			assert.equal(mismatch.command, null);
			assert.match(mismatch.error ?? "", /found 12\.6\.0, 11\.1\.1/);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

await test("native pnpm requires its own version/platform metadata and a native file", async () => {
	await fixture(async (root) => {
		const native = await nativeFixture(root, "11.1.1");
		const previous = process.env.PATH;
		process.env.PATH = root;
		try {
			for (const metadata of [
				{ ...native.metadata, version: undefined },
				{ ...native.metadata, name: "pnpm" },
				{ ...native.metadata, os: ["other-os"] },
				{ ...native.metadata, cpu: ["other-cpu"] },
				{ ...native.metadata, publishConfig: undefined },
			]) {
				await writeFile(join(root, "package.json"), JSON.stringify(metadata));
				assert.equal(
					(await resolveTool({ name: "pnpm", version: null, lockfile: null }))
						.available,
					false
				);
			}
			await writeFile(
				join(root, "package.json"),
				JSON.stringify(native.metadata)
			);
			await writeFile(native.entry, "#!/bin/sh\nnode downloader.mjs");
			assert.equal(
				(await resolveTool({ name: "pnpm", version: null, lockfile: null }))
					.available,
				false
			);
			await rm(native.entry);
			assert.equal(
				(await resolveTool({ name: "pnpm", version: null, lockfile: null }))
					.available,
				false
			);
			await rm(join(root, "package.json"));
			assert.equal(
				(await resolveTool({ name: "pnpm", version: null, lockfile: null }))
					.available,
				false
			);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

await test("native pnpm executable symlinks cannot escape their metadata package", async () => {
	await fixture(async (root) => {
		const native = await nativeFixture(join(root, "tool"), "11.1.1");
		const outside = join(root, "outside");
		await mkdir(outside);
		await rm(native.entry);
		await symlink(
			outside,
			native.entry,
			process.platform === "win32" ? "junction" : "dir"
		);
		const previous = process.env.PATH;
		process.env.PATH = native.root;
		try {
			assert.equal(
				(await resolveTool({ name: "pnpm", version: "11.1.1", lockfile: null }))
					.available,
				false
			);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

await test("npm-installed pnpm .bin relative shims resolve without executing the shim", async () => {
	await fixture(async (root) => {
		const shims = join(root, "node_modules", ".bin");
		const packageRoot = join(root, "node_modules", "pnpm");
		await mkdir(shims, { recursive: true });
		await mkdir(join(packageRoot, "bin"), { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({
				name: "pnpm",
				version: "11.1.1",
				bin: { pnpm: "bin/pnpm.cjs" },
			})
		);
		await writeFile(
			join(packageRoot, "bin", "pnpm.cjs"),
			"console.log(JSON.stringify(process.argv.slice(2)))"
		);
		const shim = join(
			shims,
			process.platform === "win32" ? "pnpm.cmd" : "pnpm"
		);
		await writeFile(
			shim,
			process.platform === "win32"
				? 'DO NOT EXECUTE\n"%dp0%\\..\\pnpm\\bin\\pnpm.cjs" %*'
				: 'DO NOT EXECUTE\nexec node "$basedir/../pnpm/bin/pnpm.cjs" "$@"'
		);
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ scripts: { check: "node check.cjs" } })
		);
		const previous = process.env.PATH;
		process.env.PATH = shims;
		try {
			const toolchain = {
				name: /** @type {const} */ ("pnpm"),
				version: "11.1.1",
				lockfile: null,
			};
			const resolved = await resolveTool(toolchain);
			assert.equal(resolved.available, true);
			assert.equal(resolved.version, "11.1.1");
			assert.deepEqual(resolved.args, [join(packageRoot, "bin", "pnpm.cjs")]);
			let output = "";
			const result = await runPlan(
				{
					project: "fixture",
					repoRoot: root,
					tasks: [
						task(root, "shim", "", {
							argv: ["pnpm", "run", "check", "--", "literal & space"],
							toolchain,
							effects: ["local-write"],
						}),
					],
				},
				{
					allowLocalWrite: true,
					onOutput: (_task, _stream, chunk) => {
						output += chunk;
					},
				}
			);
			assert.equal(result.status, "success");
			assert.deepEqual(JSON.parse(output), [
				"run",
				"check",
				"--",
				"literal & space",
			]);
			await writeFile(shim, "node arbitrary-downloader.cjs");
			assert.equal((await resolveTool(toolchain)).available, false);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

await test("pnpm native wrappers use installed matching platform metadata and never download", async () => {
	await fixture(async (root) => {
		const shims = join(root, "node_modules", ".bin");
		const packageRoot = join(root, "node_modules", "pnpm");
		const nativeRoot = join(
			root,
			"node_modules",
			"@pnpm",
			`exe.${process.platform}-${process.arch}`
		);
		await mkdir(shims, { recursive: true });
		await mkdir(packageRoot, { recursive: true });
		const native = await nativeFixture(nativeRoot, "12.6.0");
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({
				name: "pnpm",
				version: "12.6.0",
				bin: { pnpm: "pnpm" },
				optionalDependencies: { [native.metadata.name]: "12.6.0" },
			})
		);
		await writeFile(join(packageRoot, "pnpm"), "DO NOT EXECUTE OR DOWNLOAD");
		await writeFile(
			join(shims, process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
			process.platform === "win32"
				? '"%dp0%\\..\\pnpm\\pnpm" %*'
				: '"$basedir/../pnpm/pnpm" "$@"'
		);
		const previous = process.env.PATH;
		process.env.PATH = shims;
		try {
			const toolchain = {
				name: /** @type {const} */ ("pnpm"),
				version: "12.6.0",
				lockfile: null,
			};
			const resolved = await resolveTool(toolchain);
			assert.equal(resolved.available, true);
			assert.equal(resolved.command, native.entry);
			assert.deepEqual(resolved.args, []);
			await writeFile(
				join(nativeRoot, "package.json"),
				JSON.stringify({ ...native.metadata, version: "11.1.1" })
			);
			assert.equal((await resolveTool(toolchain)).available, false);
			await rm(nativeRoot, { recursive: true, force: true });
			assert.equal((await resolveTool(toolchain)).available, false);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

await test("pnpm 11 scoped exe shims resolve legacy platform packages with files metadata", async () => {
	await fixture(async (root) => {
		const shims = join(root, "node_modules", ".bin");
		const wrapper = join(root, "node_modules", "@pnpm", "exe");
		const osName =
			process.platform === "win32"
				? "win"
				: process.platform === "darwin"
					? "macos"
					: process.platform;
		const arch =
			process.platform === "win32" && process.arch === "ia32"
				? "x86"
				: process.arch;
		const name = `@pnpm/${osName}-${arch}`;
		const native = await nativeFixture(
			join(root, "node_modules", ...name.split("/")),
			"11.1.1"
		);
		const filename = process.platform === "win32" ? "pnpm.exe" : "pnpm";
		await writeFile(
			join(native.root, "package.json"),
			JSON.stringify({
				name,
				version: "11.1.1",
				os: [process.platform],
				cpu: [process.arch],
				files: [filename],
			})
		);
		await mkdir(join(native.root, "dist"), { recursive: true });
		await writeFile(
			join(native.root, "dist", "pnpm.mjs"),
			"// Runtime fixture is never executed during static resolution."
		);
		await mkdir(shims, { recursive: true });
		await mkdir(wrapper, { recursive: true });
		await writeFile(
			join(wrapper, "package.json"),
			JSON.stringify({
				name: "@pnpm/exe",
				version: "11.1.1",
				bin: { pnpm: "pnpm" },
				optionalDependencies: { [name]: "11.1.1" },
			})
		);
		await writeFile(
			join(wrapper, "pnpm"),
			"This file intentionally left blank"
		);
		await writeFile(
			join(shims, process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
			process.platform === "win32"
				? '"%dp0%\\..\\@pnpm\\exe\\pnpm" %*'
				: '"$basedir/../@pnpm/exe/pnpm" "$@"'
		);
		const previous = process.env.PATH;
		try {
			for (const path of [shims, native.root]) {
				process.env.PATH = path;
				const resolved = await resolveTool({
					name: "pnpm",
					version: "11.1.1",
					lockfile: null,
				});
				assert.equal(resolved.available, true);
				assert.equal(resolved.command, native.entry);
				assert.deepEqual(resolved.args, []);
			}
			await rm(join(native.root, "dist", "pnpm.mjs"));
			assert.equal(
				(await resolveTool({ name: "pnpm", version: "11.1.1", lockfile: null }))
					.available,
				false
			);
			await symlink(
				root,
				join(native.root, "dist", "pnpm.mjs"),
				process.platform === "win32" ? "junction" : "dir"
			);
			assert.equal(
				(await resolveTool({ name: "pnpm", version: "11.1.1", lockfile: null }))
					.available,
				false
			);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

await test("pnpm 11 module entry requires matching package metadata and an internal bundle", async () => {
	await fixture(async (root) => {
		const shims = join(root, "node_modules", ".bin");
		const packageRoot = join(root, "node_modules", "pnpm");
		await mkdir(shims, { recursive: true });
		await mkdir(join(packageRoot, "bin"), { recursive: true });
		await mkdir(join(packageRoot, "dist"), { recursive: true });
		const metadata = {
			name: "pnpm",
			version: "11.1.1",
			type: "module",
			main: "bin/pnpm.mjs",
			bin: { pnpm: "bin/pnpm.mjs" },
		};
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify(metadata)
		);
		const entry = join(packageRoot, "bin", "pnpm.mjs");
		const bundle = join(packageRoot, "dist", "pnpm.mjs");
		await writeFile(entry, "await import('../dist/pnpm.mjs')");
		await writeFile(
			bundle,
			"console.log(JSON.stringify(process.argv.slice(2)))"
		);
		await writeFile(
			join(shims, process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
			process.platform === "win32"
				? '"%dp0%\\..\\pnpm\\bin\\pnpm.mjs" %*'
				: 'exec node "$basedir/../pnpm/bin/pnpm.mjs" "$@"'
		);
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ scripts: { check: "node check.mjs" } })
		);
		const previous = process.env.PATH;
		process.env.PATH = shims;
		try {
			const toolchain = {
				name: /** @type {const} */ ("pnpm"),
				version: "11.1.1",
				lockfile: null,
			};
			const resolved = await resolveTool(toolchain);
			assert.equal(resolved.available, true);
			assert.deepEqual(resolved.args, [entry]);
			let output = "";
			const result = await runPlan(
				{
					project: "fixture",
					repoRoot: root,
					tasks: [
						task(root, "module", "", {
							argv: ["pnpm", "run", "check"],
							toolchain,
							effects: ["local-write"],
						}),
					],
				},
				{
					allowLocalWrite: true,
					onOutput: (_task, _stream, chunk) => {
						output += chunk;
					},
				}
			);
			assert.equal(result.status, "success");
			assert.deepEqual(JSON.parse(output), ["run", "check"]);
			await writeFile(
				join(packageRoot, "package.json"),
				JSON.stringify({ ...metadata, version: "12.6.0" })
			);
			assert.equal(
				(await resolveTool({ ...toolchain, version: "12.6.0" })).available,
				false
			);
			await writeFile(
				join(packageRoot, "package.json"),
				JSON.stringify(metadata)
			);
			await rm(bundle);
			assert.equal((await resolveTool(toolchain)).available, false);
			await symlink(
				join(root, "node_modules"),
				join(packageRoot, "dist", "pnpm.mjs"),
				process.platform === "win32" ? "junction" : "dir"
			);
			assert.equal((await resolveTool(toolchain)).available, false);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

await test("installed npm runs a local script without the Windows command shim", async (context) => {
	const toolchain = {
		name: /** @type {const} */ ("npm"),
		version: null,
		lockfile: null,
	};
	if (!(await resolveTool(toolchain)).available) {
		context.skip("No installed npm CLI with static metadata");
		return;
	}
	await fixture(async (root) => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ private: true, scripts: { check: "node check.cjs" } })
		);
		await writeFile(
			join(root, "check.cjs"),
			"console.log('cina-npm-fixture-ok')"
		);
		let output = "";
		const result = await runPlan(
			{
				project: "fixture",
				repoRoot: root,
				tasks: [
					task(root, "npm", "", {
						argv: ["npm", "run", "check"],
						toolchain,
						effects: ["local-write"],
					}),
				],
			},
			{
				allowLocalWrite: true,
				onOutput: (_id, _stream, chunk) => {
					output += chunk;
				},
			}
		);
		assert.equal(result.status, "success", output);
		assert.match(output, /cina-npm-fixture-ok/);
		assert.doesNotMatch(
			output,
			/Unknown env config.*manage-package-manager-versions/
		);
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				scripts: { check: "node check.cjs", postcheck: "node marker.cjs" },
			})
		);
		await writeFile(
			join(root, "marker.cjs"),
			"require('node:fs').writeFileSync('unexpected-hook','executed')"
		);
		const hooked = await runPlan(
			{
				project: "fixture",
				repoRoot: root,
				tasks: [
					task(root, "hook", "", {
						argv: ["npm", "run", "check"],
						toolchain,
						effects: ["local-write"],
					}),
				],
			},
			{ allowLocalWrite: true }
		);
		assert.equal(hooked.status, "invalid");
		assert.match(hooked.error ?? "", /implicit pre\/post/);
		await assert.rejects(readFile(join(root, "unexpected-hook")), {
			code: "ENOENT",
		});
		const escaped = await runPlan(
			{
				project: "fixture",
				repoRoot: root,
				tasks: [
					task(root, "npm", "", {
						argv: ["npm", "run", "check", "--prefix", tmpdir()],
						toolchain,
						effects: ["local-write"],
					}),
				],
			},
			{ allowLocalWrite: true }
		);
		assert.equal(escaped.status, "invalid");
		assert.match(
			escaped.error ?? "",
			/explicit installed package-manager run script/
		);
	});
});

await test("npm stock prefix shim maps its percent-tilde-dp0 parameter without running prefix discovery", async () => {
	await fixture(async (root) => {
		const packageRoot = join(root, "node_modules", "npm");
		await mkdir(join(packageRoot, "bin"), { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({
				name: "npm",
				version: "999.1.1",
				bin: { npm: "bin/npm-cli.js" },
			})
		);
		const entry = join(packageRoot, "bin", "npm-cli.js");
		await writeFile(
			entry,
			"console.log(JSON.stringify(process.argv.slice(2)))"
		);
		await writeFile(
			join(root, process.platform === "win32" ? "npm.cmd" : "npm"),
			process.platform === "win32"
				? 'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\nFOR /F %%F IN (\'CALL unreviewed-prefix\') DO SET NPM_PREFIX=%%F\n"%NODE_EXE%" "%NPM_CLI_JS%" %*'
				: 'exec node "$basedir/node_modules/npm/bin/npm-cli.js" "$@"'
		);
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ scripts: { check: "node check.cjs" } })
		);
		const previous = process.env.PATH;
		process.env.PATH = root;
		try {
			const toolchain = {
				name: /** @type {const} */ ("npm"),
				version: "999.1.1",
				lockfile: null,
			};
			const resolved = await resolveTool(toolchain);
			assert.equal(resolved.available, true);
			assert.deepEqual(resolved.args, [entry]);
			let output = "";
			const result = await runPlan(
				{
					project: "fixture",
					repoRoot: root,
					tasks: [
						task(root, "stock", "", {
							argv: ["npm", "run", "check"],
							toolchain,
							effects: ["local-write"],
						}),
					],
				},
				{
					allowLocalWrite: true,
					onOutput: (_task, _stream, chunk) => {
						output += chunk;
					},
				}
			);
			assert.equal(result.status, "success");
			assert.deepEqual(JSON.parse(output), ["run", "check"]);
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
		}
	});
});

await test("package manager cache and isolated config paths cannot escape or load existing config", async () => {
	await fixture(async (root) => {
		const repo = join(root, "repo");
		const outside = join(root, "outside");
		await mkdir(repo);
		await mkdir(outside);
		await writeFile(
			join(repo, "package.json"),
			JSON.stringify({ scripts: { check: "node check.cjs" } })
		);
		const toolchain = {
			name: /** @type {const} */ ("npm"),
			version: null,
			lockfile: null,
		};
		const plan = {
			project: "fixture",
			repoRoot: repo,
			tasks: [
				task(repo, "cache", "", {
					argv: ["npm", "run", "check"],
					toolchain,
					effects: ["local-write"],
				}),
			],
		};
		const cache = join(repo, ".cina-cache");
		await symlink(
			outside,
			cache,
			process.platform === "win32" ? "junction" : "dir"
		);
		const escaped = await runPlan(plan, { allowLocalWrite: true });
		assert.equal(escaped.status, "invalid");
		assert.match(escaped.error ?? "", /Cache\/config path escapes/);
		await rm(cache);
		await mkdir(cache);
		await writeFile(join(cache, "disabled-global.npmrc"), "unused=1");
		const configured = await runPlan(plan, { allowLocalWrite: true });
		assert.equal(configured.status, "invalid");
		assert.match(
			configured.error ?? "",
			/isolated global config must remain absent/
		);
		const unauthorized = await runPlan(
			{
				...plan,
				tasks: [
					task(repo, "cache", "", { argv: ["npm", "run", "check"], toolchain }),
				],
			},
			{ allowLocalWrite: true }
		);
		assert.equal(unauthorized.status, "invalid");
		assert.match(
			unauthorized.error ?? "",
			/package managers require local-write/
		);
	});
});

await test("package script drift after preflight is rejected before execution", async () => {
	await fixture(async (root) => {
		const toolchain = {
			name: /** @type {const} */ ("npm"),
			version: null,
			lockfile: null,
		};
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ scripts: { check: "node check.cjs" } })
		);
		const script = `require('node:fs').writeFileSync('package.json',${JSON.stringify(JSON.stringify({ scripts: { check: "node unexpected.cjs" } }))})`;
		const result = await runPlan(
			{
				project: "fixture",
				repoRoot: root,
				tasks: [
					task(root, "change", script, { effects: ["local-write"] }),
					task(root, "check", "", {
						argv: ["npm", "run", "check"],
						script: "node check.cjs",
						toolchain,
						effects: ["local-write"],
					}),
				],
			},
			{ allowLocalWrite: true }
		);
		assert.equal(result.status, "partial");
		assert.equal(result.tasks[1]?.status, "invalid");
		assert.match(result.tasks[1]?.error ?? "", /changed since manifest review/);
	});
});
