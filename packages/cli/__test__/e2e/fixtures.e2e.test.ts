import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { V03_PROJECT } from "../../../engine/__test__/fixtures/bundles.js";
import type { Sandbox } from "./utils/fixtures.js";
import { makeSandbox, removeSandbox, writeSeedInto } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";
import { TestPlatform } from "./utils/platform.js";

interface Report {
	readonly summary: Record<string, number>;
	readonly diagnostics: ReadonlyArray<{ file: string; code: string; severity: string }>;
}

const withSandbox = <A, E, R>(use: (sandbox: Sandbox) => Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Effect.promise(() => makeSandbox()),
		use,
		(sandbox) => Effect.promise(() => removeSandbox(sandbox)),
	);

describe("fixture seeds on disk (R1b)", () => {
	it.effect("V03_PROJECT written to a sandbox validates with no errors", () =>
		withSandbox((sandbox) =>
			Effect.gen(function* () {
				yield* Effect.promise(() => writeSeedInto(sandbox.cwd, V03_PROJECT));
				const result = yield* runOkfit(["validate", "--format", "json"], sandbox);
				const json = JSON.parse(result.stdout) as Report;
				assert.strictEqual(result.exitCode, 0);
				assert.strictEqual(json.summary.conformance_errors, 0);
				assert.strictEqual(json.summary.lint_errors, 0);
				assert.strictEqual(json.summary.profile_errors, 0);
				assert.strictEqual(json.summary.concepts, 6);
				// README.md is the seed's deliberate frontmatter-less file. `verified-drift` stays: the seed's
				// `verified` entry has no `integrity` digest, and a fake digest would hide the very thing it reports.
				assert.deepStrictEqual(
					json.diagnostics.map((d) => [d.file, d.code, d.severity]),
					[
						["README.md", "frontmatter-missing", "warning"],
						["metrics/revenue.md", "verified-drift", "warning"],
					],
				);
				// Positive control: an unclosed frontmatter fence does report a conformance error.
				yield* Effect.promise(() => writeSeedInto(sandbox.cwd, { "okf/broken.md": "---\ntype: Metric\n" }));
				const broken = yield* runOkfit(["validate", "--format", "json"], sandbox);
				assert.isAbove((JSON.parse(broken.stdout) as Report).summary.conformance_errors ?? 0, 0);
			}),
		).pipe(Effect.provide(TestPlatform)),
	);
});
