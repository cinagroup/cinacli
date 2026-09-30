import { copyFile, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.join(packageRoot, "src");
const destinationRoot = path.join(packageRoot, "dist");

// Keep cleanup confined to this package's own build output.
try {
	if ((await lstat(destinationRoot)).isSymbolicLink()) {
		throw new Error("Refusing to build into a symbolic-link dist directory");
	}
} catch (error) {
	if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
		throw error;
	}
}

await rm(destinationRoot, { recursive: true, force: true });
await mkdir(destinationRoot, { recursive: true });

/** @type {(source: string, destination: string) => Promise<void>} */
const copyModules = async (source, destination) => {
	const entries = await readdir(source, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
	for (const entry of entries) {
		const input = path.join(source, entry.name);
		const output = path.join(destination, entry.name);
		if (entry.isSymbolicLink()) {
			throw new Error(`Refusing to copy symbolic-link source: ${input}`);
		}
		if (entry.isDirectory()) {
			await mkdir(output, { recursive: true });
			await copyModules(input, output);
		} else if (entry.isFile() && entry.name.endsWith(".mjs")) {
			await copyFile(input, output);
		}
	}
};

await copyModules(sourceRoot, destinationRoot);
