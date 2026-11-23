import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { V03_PROJECT } from "../../../engine/__test__/fixtures/bundles.js";
import { makeSandbox, removeSandbox, writeSeedInto } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";
import { TestPlatform } from "./utils/platform.js";

describe("fixture seeds on disk (R1b)", () => {
	it.effect("V03_PROJECT written to a sandbox validates with no conformance errors", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => writeSeedInto(sandbox.cwd, V03_PROJECT));
			const result = yield* runOkfit(["validate", "--format", "json"], sandbox);
			// Captured after `pnpm build`: with no config, `[types]` declares nothing and the default profile
			// wants a Project concept, so lint and profile errors fire. The conformance count is the seed's claim.
			const json = JSON.parse(result.stdout) as {
				summary: Record<string, number>;
				diagnostics: ReadonlyArray<{ file: string; code: string; severity: string }>;
			};
			assert.strictEqual(result.exitCode, 1);
			assert.strictEqual(json.summary.conformance_errors, 0);
			assert.strictEqual(json.summary.concepts, 5);
			assert.deepStrictEqual(
				json.diagnostics.map((d) => [d.file, d.code, d.severity]),
				[
					["", "project-missing", "error"],
					["README.md", "frontmatter-missing", "warning"],
					["computations/index.md", "missing-index", "warning"],
					["computations/revenue-ytd.md", "required-key-missing", "error"],
					["computations/revenue-ytd.md", "status-missing", "warning"],
					["computations/revenue-ytd.md", "unknown-type", "error"],
					["metrics/index.md", "missing-index", "warning"],
					["metrics/margin-legacy.md", "required-key-missing", "error"],
					["metrics/margin-legacy.md", "unknown-type", "error"],
					["metrics/margin.md", "required-key-missing", "error"],
					["metrics/margin.md", "status-missing", "warning"],
					["metrics/margin.md", "unknown-type", "error"],
					["metrics/revenue.md", "required-key-missing", "error"],
					["metrics/revenue.md", "unknown-type", "error"],
					["metrics/revenue.md", "verified-drift", "warning"],
					["modules/index.md", "missing-index", "warning"],
					["modules/widget.md", "required-key-missing", "error"],
					["modules/widget.md", "required-key-missing", "error"],
					["modules/widget.md", "status-missing", "warning"],
				],
			);
			// Positive control: a seed with a broken frontmatter fence does report a conformance error.
			yield* Effect.promise(() => writeSeedInto(sandbox.cwd, { "okf/broken.md": "---\ntype: Metric\n" }));
			const broken = yield* runOkfit(["validate", "--format", "json"], sandbox);
			const brokenJson = JSON.parse(broken.stdout) as { summary: Record<string, number> };
			assert.isAbove(brokenJson.summary.conformance_errors ?? 0, 0);
			yield* Effect.promise(() => removeSandbox(sandbox));
		}).pipe(Effect.provide(TestPlatform)),
	);
});
