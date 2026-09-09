import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { forDiagnostics, tally } from "../../src/render/exit.js";
import type { RenderedDiagnostic } from "../../src/render/sort.js";

const of = (source: RenderedDiagnostic["source"], severity: RenderedDiagnostic["severity"]): RenderedDiagnostic => ({
	source,
	severity,
	file: "a.md",
	code: "x",
	message: "m",
});

describe("tally", () => {
	it.effect("counts each source/severity combination independently", () =>
		Effect.sync(() => {
			const t = tally([
				of("core.conformance", "error"),
				of("core.lint", "error"),
				of("core.lint", "warning"),
				of("core.lint", "info"),
				of("profile", "error"),
			]);
			assert.deepStrictEqual(t, {
				conformanceErrors: 1,
				lintErrors: 1,
				lintWarnings: 1,
				lintInfo: 1,
				profileErrors: 1,
			});
		}),
	);

	it.effect("a warning or info severity never increments an error count, for any source", () =>
		Effect.sync(() => {
			const t = tally([of("core.conformance", "warning"), of("profile", "info")]);
			assert.deepStrictEqual(t, {
				conformanceErrors: 0,
				lintErrors: 0,
				lintWarnings: 0,
				lintInfo: 0,
				profileErrors: 0,
			});
		}),
	);

	it.effect("an empty diagnostic list tallies to all zeros", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(tally([]), {
				conformanceErrors: 0,
				lintErrors: 0,
				lintWarnings: 0,
				lintInfo: 0,
				profileErrors: 0,
			});
		}),
	);
});

describe("forDiagnostics", () => {
	it.effect("a conformance error wins tier 2 even alongside a co-occurring lint error", () =>
		Effect.sync(() => {
			assert.strictEqual(forDiagnostics([of("core.conformance", "error"), of("core.lint", "error")]), 2);
		}),
	);

	it.effect("a lint error alone is tier 1", () =>
		Effect.sync(() => {
			assert.strictEqual(forDiagnostics([of("core.lint", "error")]), 1);
		}),
	);

	it.effect("a profile error alone lands in tier 1, same as a lint error (K-7)", () =>
		Effect.sync(() => {
			assert.strictEqual(forDiagnostics([of("profile", "error")]), 1);
		}),
	);

	it.effect("warnings and info alone never move the exit code off 0", () =>
		Effect.sync(() => {
			assert.strictEqual(
				forDiagnostics([of("core.lint", "warning"), of("core.lint", "info"), of("core.conformance", "warning")]),
				0,
			);
		}),
	);

	it.effect("no diagnostics at all is tier 0", () =>
		Effect.sync(() => {
			assert.strictEqual(forDiagnostics([]), 0);
		}),
	);
});
