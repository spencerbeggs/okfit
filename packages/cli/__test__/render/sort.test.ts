import { assert, describe, it } from "@effect/vitest";
import { Diagnostic, DiagnosticRange } from "@okfit/core";
import type { ProfileDiagnostic } from "@okfit/profiles";
import { Effect } from "effect";
import type { RenderedDiagnostic } from "../../src/render/sort.js";
import { collect, sort } from "../../src/render/sort.js";

const range = (offset: number): DiagnosticRange => DiagnosticRange.make({ offset, length: 1, line: 0, character: 0 });

describe("collect", () => {
	it.effect("tags conformance, lint and profile entries with their producer", () =>
		Effect.sync(() => {
			const conformance = [Diagnostic.make({ file: "a.md", code: "type-missing", severity: "error", message: "m1" })];
			const lint = [Diagnostic.make({ file: "b.md", code: "broken-links", severity: "warning", message: "m2" })];
			const profile: ReadonlyArray<ProfileDiagnostic> = [
				{ file: "", code: "project-missing", severity: "error", message: "m3" },
			];
			const result = collect(conformance, lint, profile);
			assert.deepStrictEqual(
				result.map((d) => d.source),
				["core.conformance", "core.lint", "profile"],
			);
			assert.strictEqual(result[0]?.file, "a.md");
			assert.strictEqual(result[1]?.code, "broken-links");
			assert.strictEqual(result[2]?.message, "m3");
		}),
	);

	it.effect("omits the range key entirely when a diagnostic carries none", () =>
		Effect.sync(() => {
			const [rendered] = collect(
				[Diagnostic.make({ file: "a.md", code: "type-missing", severity: "error", message: "m" })],
				[],
				[],
			);
			assert.isFalse(Object.hasOwn(rendered ?? {}, "range"));
		}),
	);

	it.effect("carries a present range through untouched, zero-based", () =>
		Effect.sync(() => {
			const [rendered] = collect(
				[],
				[
					Diagnostic.make({
						file: "a.md",
						code: "broken-links",
						severity: "warning",
						message: "m",
						range: range(4),
					}),
				],
				[],
			);
			assert.strictEqual(rendered?.range?.offset, 4);
		}),
	);
});

describe("sort", () => {
	const of = (file: string, code: string, r?: DiagnosticRange): RenderedDiagnostic => ({
		source: "core.lint",
		file,
		code,
		severity: "error",
		message: "m",
		...(r === undefined ? {} : { range: r }),
	});

	it.effect('orders file ascending, so a bundle-level ("") entry leads', () =>
		Effect.sync(() => {
			const result = sort([of("b.md", "z"), of("", "z"), of("a.md", "z")]);
			assert.deepStrictEqual(
				result.map((d) => d.file),
				["", "a.md", "b.md"],
			);
		}),
	);

	it.effect("within one file, range-less entries sort before ranged ones", () =>
		Effect.sync(() => {
			const result = sort([of("a.md", "z", range(0)), of("a.md", "y")]);
			assert.deepStrictEqual(
				result.map((d) => d.code),
				["y", "z"],
			);
			assert.isUndefined(result[0]?.range);
		}),
	);

	it.effect("ranged entries in one file order by range.offset ascending", () =>
		Effect.sync(() => {
			const result = sort([of("a.md", "z", range(9)), of("a.md", "y", range(1))]);
			assert.deepStrictEqual(
				result.map((d) => d.code),
				["y", "z"],
			);
		}),
	);

	it.effect("equal file and range order by code, plain code-unit comparison", () =>
		Effect.sync(() => {
			const result = sort([of("a.md", "b"), of("a.md", "A")]);
			assert.deepStrictEqual(
				result.map((d) => d.code),
				["A", "b"],
			);
		}),
	);

	it.effect("is stable: two entries with equal file, range and code keep their input order", () =>
		Effect.sync(() => {
			const first = of("a.md", "z");
			const second = of("a.md", "z");
			const result = sort([first, second]);
			assert.strictEqual(result[0], first);
			assert.strictEqual(result[1], second);
		}),
	);
});
