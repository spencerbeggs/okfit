import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";
import { findAppImportNames } from "./utils/boundaries.js";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/** K-9: no file under `src/` may import these three names from `@effected/app`. */
const FORBIDDEN_APP_IMPORTS = ["App", "AppStore", "AppCache"];

const walk = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
	});

describe("@okfit/engine boundaries", () => {
	// `@effected/workspaces/testing`'s `SourceBoundary` replaces this
	// package's own hand-rolled comment-stripping `process` scanner (K-32):
	// its "process" rule already exempts `process.env.__PACKAGE_VERSION__`
	// -- the ONE token `version.ts` reads -- unconditionally (the bundler
	// substitutes it at build time), so this package's own allowlist can be
	// truly empty; no other file under `src/` may read `process` at all.
	it.effect(
		"no file under src/ reads `process` -- SourceBoundary's own `__PACKAGE_VERSION__` exemption covers version.ts",
		() =>
			Effect.gen(function* () {
				const fixtureFailures = SourceBoundary.verifyFixtures();
				assert.deepStrictEqual(fixtureFailures, []);
				const scan = yield* SourceBoundary.scan({ root: SRC_ROOT, rules: ["process", "node:process"] });
				// Non-vacuity: an empty `root` glob or a typo'd path would
				// otherwise report a spotless boundary because nothing was
				// scanned at all.
				assert.isAbove(scan.files.length, 0);
				assert.deepStrictEqual(scan.violations, []);
			}).pipe(Effect.provide(NodeServices.layer)),
	);

	// A positive control for the `"node:process"` rule: the `"process"` rule
	// alone misses a named/default/namespace import of the `node:process`
	// specifier (review finding I2), so this proves the second rule catches
	// what the first one does not.
	it("SourceBoundary.check flags a node:process import", () => {
		const offending = SourceBoundary.check("platform.ts", 'import { stdout } from "node:process";', ["node:process"]);
		assert.isAbove(offending.length, 0);
	});

	// SourceBoundary's `forbidImports` only forbids a whole specifier, never
	// specific named imports from an otherwise-legitimate module -- this
	// package's own `config/layer.ts` legitimately imports `AppConfig` from
	// `@effected/app`, so a blanket `{ forbidImports: ["@effected/app"] }`
	// is not available here the way it is for `@okfit/cli` (which imports
	// nothing from that module at all -- see `packages/cli/__test__/boundaries.test.ts`).
	// This scanner stays hand-rolled for that reason.
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
