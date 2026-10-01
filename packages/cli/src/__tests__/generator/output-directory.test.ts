import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Forge, SourceFile } from "@cloudflare/forge";
import { describe, expect, it } from "vitest";
import { resolveOutputDirectory } from "../../../generator/output-directory.js";

describe("resolveOutputDirectory", () => {
	it.each(["string", "URL"])(
		"decodes a %s file URL into an absolute native path",
		(baseType) => {
			const directory = join(tmpdir(), "cf generator 中文");
			const url = pathToFileURL(join(directory, "generate.ts"));
			const output = resolveOutputDirectory(
				baseType === "string" ? url.href : url,
				"./src/commands/_generated"
			);

			expect(isAbsolute(output)).toBe(true);
			expect(output).toBe(join(directory, "src", "commands", "_generated"));
			expect(output).toContain("cf generator 中文");
			expect(output).not.toContain("%20");
			expect(output).not.toContain("%E4");
		}
	);

	it("writes Forge output beneath the decoded directory", async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "cf-generator output 中文-")
		);
		try {
			const output = resolveOutputDirectory(
				pathToFileURL(join(temporary, "generate.ts")),
				"./src/commands/_generated"
			);
			// Verify the target before finalize can clean or write any directory.
			expect(output).toBe(join(temporary, "src", "commands", "_generated"));
			expect(isAbsolute(output)).toBe(true);

			const forge = new Forge({
				openapi: "3.0.0",
				info: { title: "output-directory regression", version: "1.0.0" },
				paths: {},
			});
			const content = 'export const greeting = "中文 output";\n';
			const files = [new SourceFile("nested/example.ts", content)];
			const written = await forge.finalize(output, files, { clean: true });

			expect(written).toEqual(files);
			expect(await readFile(join(output, "nested", "example.ts"), "utf8")).toBe(
				content
			);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});
});
