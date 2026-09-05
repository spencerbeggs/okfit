import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { assert, describe, it } from "@effect/vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/**
 * K-39's allowlist: `bin.ts`, every file under `commands/`, `internal/exit.ts`,
 * `internal/tty.ts`. Everything else under `src/` must never read `process`.
 */
const isAllowedToReadProcess = (relativePath: string): boolean =>
	relativePath === "bin.ts" ||
	relativePath.startsWith("commands/") ||
	relativePath === "internal/exit.ts" ||
	relativePath === "internal/tty.ts";

/** K-9: no file under `src/` may import these three names from `@effected/app`. */
const FORBIDDEN_APP_IMPORTS = ["App", "AppStore", "AppCache"];

const walk = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
	});

describe("src boundaries (K-9, K-39, K-49)", () => {
	const files = walk(SRC_ROOT);

	it("finds at least one source file to check", () => {
		assert.isTrue(files.length > 0);
	});

	for (const file of files) {
		const relativePath = relative(SRC_ROOT, file).split("\\").join("/");
		const contents = readFileSync(file, "utf8");

		it(`${relativePath} imports no App, AppStore, or AppCache from @effected/app (K-9)`, () => {
			const importLines = contents.split("\n").filter((line) => line.includes("@effected/app"));
			for (const line of importLines) {
				for (const name of FORBIDDEN_APP_IMPORTS) {
					assert.isFalse(
						new RegExp(`\\b${name}\\b`).test(line),
						`${relativePath} imports ${name} from @effected/app: ${line.trim()}`,
					);
				}
			}
		});

		it(`${relativePath} touches process only if it is on the K-39 allowlist`, () => {
			const referencesProcess = /\bprocess\b/.test(contents);
			if (isAllowedToReadProcess(relativePath)) return;
			assert.isFalse(referencesProcess, `${relativePath} references process but is not on the K-39 allowlist`);
		});
	}
});
