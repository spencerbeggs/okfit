import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { findAppImportNames, stripComments } from "./utils/boundaries.js";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/** K-9: no file under `src/` may import these three names from `@effected/app`. */
const FORBIDDEN_APP_IMPORTS = ["App", "AppStore", "AppCache"];

const walk = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
	});

/**
 * `version.ts`'s `process.env.__PACKAGE_VERSION__` is a build-time constant
 * `@savvy-web/bundler` replaces at compile time (K-32), not a runtime
 * environment read -- the same carve-out `@okfit/cli` and `@okfit/mcp`
 * document for their own `version.ts`. Every other file under `src/` must
 * never read `process` at all.
 */
const isAllowedToReadProcess = (relativePath: string): boolean => relativePath === "version.ts";

describe("@okfit/engine boundaries", () => {
	it("no file under src/ reads `process` -- exactly one allowlisted file (version.ts)", () => {
		const offenders = walk(SRC_ROOT).filter(
			(file) =>
				!isAllowedToReadProcess(relative(SRC_ROOT, file)) &&
				/\bprocess\s*\./.test(stripComments(readFileSync(file, "utf8"))),
		);
		assert.deepStrictEqual(
			offenders.map((file) => relative(SRC_ROOT, file)),
			[],
		);
	});

	it("no file under src/ imports App, AppStore or AppCache from @effected/app (K-9)", () => {
		const offenders = walk(SRC_ROOT).flatMap((file) => {
			const names = findAppImportNames(readFileSync(file, "utf8"));
			return names
				.filter((name) => FORBIDDEN_APP_IMPORTS.includes(name))
				.map((name) => `${relative(SRC_ROOT, file)}: ${name}`);
		});
		assert.deepStrictEqual(offenders, []);
	});
});
