import { fileURLToPath } from "node:url";

export function resolveOutputDirectory(
	baseURL: string | URL,
	relative: string
): string {
	return fileURLToPath(new URL(relative, baseURL));
}
