import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

describe("src boundaries (K-9, K-39)", () => {
	// `@effected/workspaces/testing`'s `SourceBoundary` replaces this
	// package's own hand-rolled comment-stripping scanner (`findAppImportNames`/
	// `stripComments`, now deleted). Two rules in one scan, since this
	// package -- unlike `@okfit/engine`, which legitimately imports
	// `AppConfig` from `@effected/app` -- imports NOTHING from that module at
	// all (config discovery moved to `@okfit/engine`): a blanket
	// `{ forbidImports: ["@effected/app"] }` is available here and is
	// strictly stronger than K-9's original "these three names" rule.
	// `version.ts` needs no `allow` entry: SourceBoundary's `process` rule
	// exempts `process.env.__PACKAGE_VERSION__` unconditionally.
	it.effect("process is read only on the K-39 allowlist, and nothing imports @effected/app (K-9)", () =>
		Effect.gen(function* () {
			const fixtureFailures = SourceBoundary.verifyFixtures();
			assert.deepStrictEqual(fixtureFailures, []);
			const scan = yield* SourceBoundary.scan({
				root: SRC_ROOT,
				rules: ["process", { forbidImports: ["@effected/app"] }],
				allow: ["bin.ts", "main.ts", "commands/**", "internal/exit.ts"],
			});
			// Non-vacuity: an empty `root` glob or a typo'd path would
			// otherwise report a spotless boundary because nothing was
			// scanned at all.
			assert.isAbove(scan.files.length, 0);
			assert.deepStrictEqual(scan.violations, []);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	// A positive control, kept as a plain assertion over the raw scanner
	// (no filesystem): proves the scan discriminates a real allowlisted vs.
	// non-allowlisted `process` read rather than passing vacuously.
	it("SourceBoundary.check flags process outside the allowlist and spares the allowlisted forms", () => {
		const offending = SourceBoundary.check("render/human.ts", "export const x = process.argv;", ["process"]);
		assert.isAbove(offending.length, 0);
		const allowed = SourceBoundary.check(
			"version.ts",
			'export const CLI_VERSION = process.env.__PACKAGE_VERSION__ ?? "0.0.0";',
			["process"],
		);
		assert.deepStrictEqual(allowed, []);
	});

	// Pins that every K-39-allowlisted relative path still names a real
	// file: a renamed or removed `bin.ts`/`main.ts`/`internal/exit.ts`
	// should fail loudly here rather than silently narrowing what the
	// allowlist ever exempts.
	it("every K-39-allowlisted relative path still names a real file", () => {
		for (const allowed of ["bin.ts", "main.ts", "internal/exit.ts"]) {
			assert.ok(existsSync(join(SRC_ROOT, allowed)), `expected ${allowed} to exist under src/`);
		}
		assert.ok(
			readdirSync(join(SRC_ROOT, "commands")).some((file) => file.endsWith(".ts")),
			"expected at least one file under commands/",
		);
	});
});
