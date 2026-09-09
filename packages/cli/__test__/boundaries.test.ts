import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { findAppImportNames, stripComments } from "./utils/boundaries.js";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/**
 * K-39's allowlist: `bin.ts`, `main.ts` (created in a later task -- listing
 * it now is a deliberate forward reference and is inert while the file does
 * not exist), every file under `commands/`, `internal/exit.ts`,
 * `internal/tty.ts`. Everything else under `src/` must never read `process`.
 */
const isAllowedToReadProcess = (relativePath: string): boolean =>
	relativePath === "bin.ts" ||
	relativePath === "main.ts" ||
	relativePath.startsWith("commands/") ||
	relativePath === "internal/exit.ts" ||
	relativePath === "internal/tty.ts";

const walk = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
	});

describe("findAppImportNames (K-9 scanner)", () => {
	it("catches a Biome-wrapped multi-line named import that a line-scoped check would miss", () => {
		const wrapped = ["import {", "\tApp,", '} from "@effected/app";', ""].join("\n");
		assert.deepStrictEqual(findAppImportNames(wrapped), ["App"]);
	});

	it("extracts every forbidden name across an aliased, type-prefixed, multi-name list", () => {
		const source = 'import { type AppCache, App as MyApp, AppStore } from "@effected/app";\n';
		assert.deepStrictEqual(findAppImportNames(source), ["App", "AppStore", "AppCache"]);
	});

	it("finds nothing when the file never imports from @effected/app", () => {
		assert.deepStrictEqual(findAppImportNames('import { Effect } from "effect";\n'), []);
	});

	it("catches a namespace import", () => {
		assert.deepStrictEqual(findAppImportNames('import * as App from "@effected/app";\n'), ["App"]);
	});

	it("catches a re-export", () => {
		assert.deepStrictEqual(findAppImportNames('export { App } from "@effected/app";\n'), ["App"]);
	});

	it("catches a default import alongside a named import", () => {
		assert.deepStrictEqual(findAppImportNames('import App, { AppConfig } from "@effected/app";\n'), ["App"]);
	});

	it("catches an import type form", () => {
		assert.deepStrictEqual(findAppImportNames('import type { App } from "@effected/app";\n'), ["App"]);
	});

	it("does not flag AppConfig, which is not a forbidden name", () => {
		assert.deepStrictEqual(findAppImportNames('import { AppConfig } from "@effected/app";\n'), []);
	});
});

describe("stripComments", () => {
	it("does not treat // inside a string literal as a comment start", () => {
		const source = 'const url = "http://x"; process.exit();';
		assert.isTrue(stripComments(source).includes("process"));
	});

	it("strips a /* */ block comment containing the word process", () => {
		assert.isFalse(/\bprocess\b/.test(stripComments("/* process */ ok();")));
	});

	it("strips a // line comment containing the word process", () => {
		assert.isFalse(/\bprocess\b/.test(stripComments("// process\nok();")));
	});

	it("does not strip a string literal that itself contains /* process */ as text", () => {
		const source = 'const s = "/* process */";';
		assert.isTrue(stripComments(source).includes("process"));
	});
});

describe("src boundaries (K-39)", () => {
	const files = walk(SRC_ROOT);

	it("finds at least one source file to check", () => {
		assert.isTrue(files.length > 0);
	});

	for (const file of files) {
		const relativePath = relative(SRC_ROOT, file).split("\\").join("/");
		const contents = readFileSync(file, "utf8");

		it(`${relativePath} touches process only if it is on the K-39 allowlist`, () => {
			const referencesProcess = /\bprocess\b/.test(stripComments(contents));
			if (isAllowedToReadProcess(relativePath)) return;
			assert.isFalse(referencesProcess, `${relativePath} references process but is not on the K-39 allowlist`);
		});
	}
});
