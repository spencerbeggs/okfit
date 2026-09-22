import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Bundle, DiagnosticRange } from "@okfit/core";
import { Effect, Layer, Path } from "effect";
import type { RenderedDiagnostic } from "../../src/render/sort.js";
import { withFallbackRange } from "../../src/session/range.js";
import { ROOT, moduleConcept } from "../utils/bundle.js";

const A = moduleConcept("A");
const platform = Layer.mergeAll(
	MemoryFileSystem.layerWith({ [`${ROOT}/a.md`]: A, [`${ROOT}/plain.md`]: "# No frontmatter\n" }),
	Path.layer,
);

const rangeless = (file: string): RenderedDiagnostic => ({
	source: "core.lint",
	file,
	code: "required-key-missing",
	severity: "error",
	message: "m",
});

describe("withFallbackRange", () => {
	it.effect("a ranged diagnostic is returned unchanged", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const ranged: RenderedDiagnostic = {
				...rangeless("a.md"),
				range: DiagnosticRange.make({ offset: 10, length: 2, line: 1, character: 3 }),
			};
			assert.strictEqual(withFallbackRange(bundle, ranged), ranged);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a bundle-level diagnostic stays range-less", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			assert.isUndefined(withFallbackRange(bundle, rangeless("")).range);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a range-less diagnostic on a concept gets the whole frontmatter block, not line 0 alone", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const range = withFallbackRange(bundle, rangeless("a.md")).range;
			if (range === undefined) return assert.fail("expected a fallback range");
			assert.strictEqual(range.offset, 0);
			assert.strictEqual(range.line, 0);
			assert.strictEqual(range.character, 0);
			assert.isAbove(range.length, 0);
			const block = A.slice(range.offset, range.offset + range.length).trimEnd();
			assert.isTrue(block.startsWith("---"));
			assert.isTrue(block.endsWith("---"));
			assert.include(block, "type: Module");
			assert.notInclude(block, "# A");
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a range-less diagnostic on a file with no frontmatter gets a zero-length range at line 0", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const range = withFallbackRange(bundle, rangeless("plain.md")).range;
			assert.deepStrictEqual(
				range === undefined ? undefined : { offset: range.offset, length: range.length, line: range.line },
				{ offset: 0, length: 0, line: 0 },
			);
		}).pipe(Effect.provide(platform)),
	);
});
