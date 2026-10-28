import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/** K-9: no file under `src/` may import these three names from `@effected/app`. */
const APP_RULE = { forbidImportedNames: { from: "@effected/app", names: ["App", "AppStore", "AppCache"] } };

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
				const scan = yield* SourceBoundary.scan({
					root: SRC_ROOT,
					rules: ["process", "node:process", { forbidTokens: ["process.env.__PACKAGE_VERSION__"] }],
					// The bundler-substituted version token is confined to version.ts.
					allowRules: { forbidTokens: ["version.ts"] },
				});
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

	// K-9: `forbidImportedNames` forbids specific names from a module that is
	// otherwise legitimately imported -- `config/layer.ts` imports `AppConfig`
	// from `@effected/app`, so a whole-specifier `forbidImports` is not
	// available here. The lexer does not see a name taken from a dynamic
	// `import()` or `require()` call, nor a computed member (`m["App"]`); the
	// retired regex scanner did not see those either.
	it.effect("no file under src/ imports App, AppStore or AppCache from @effected/app (K-9)", () =>
		Effect.gen(function* () {
			const scan = yield* SourceBoundary.scan({ root: SRC_ROOT, rules: [APP_RULE] });
			assert.isAbove(scan.files.length, 0);
			assert.deepStrictEqual(scan.violations, []);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	// Positive controls: the rule fires on each import form and lets AppConfig through.
	it("the K-9 rule flags App in each import form and lets AppConfig through", () => {
		const flagged = (source: string) => SourceBoundary.check("x.ts", source, [APP_RULE]).length;
		assert.isAbove(flagged('import {\n\tApp,\n} from "@effected/app";'), 0);
		assert.isAbove(flagged('import { type AppCache, App as MyApp, AppStore } from "@effected/app";'), 0);
		assert.isAbove(flagged('import type { App } from "@effected/app";'), 0);
		assert.isAbove(flagged('export { App } from "@effected/app";'), 0);
		// A default import binds the module's `default` export, not `App`; only `names: ["default"]` forbids it.
		assert.strictEqual(flagged('import App, { AppConfig } from "@effected/app";'), 0);
		assert.isAbove(flagged('import * as m from "@effected/app";\nm.App;'), 0);
		assert.strictEqual(flagged('import { AppConfig } from "@effected/app";'), 0);
		assert.strictEqual(flagged('import { Effect } from "effect";'), 0);
	});
});
