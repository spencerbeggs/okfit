import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Bundle } from "@okfit/core";
import { Effect, Layer, Option, Path } from "effect";
import { conceptFor } from "../../src/session/concept.js";
import { ROOT, SEED } from "../utils/bundle.js";

const platform = Layer.mergeAll(MemoryFileSystem.layerWith(SEED), Path.layer);

describe("session/concept conceptFor", () => {
	it.effect("finds the loaded concept at an absolute path under the bundle root", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const found = conceptFor(bundle, `${ROOT}/a.md`);
			assert.isTrue(Option.isSome(found));
			assert.strictEqual(Option.getOrThrow(found).path, "a.md");
		}).pipe(Effect.provide(platform)),
	);

	it.effect("returns None for a path outside the bundle root (positive control above)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			assert.isTrue(Option.isNone(conceptFor(bundle, "/somewhere/else/a.md")));
		}).pipe(Effect.provide(platform)),
	);

	it.effect("returns None for a reserved file (index.md is never a concept)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			assert.isTrue(Option.isNone(conceptFor(bundle, `${ROOT}/index.md`)));
		}).pipe(Effect.provide(platform)),
	);

	it.effect("returns None for a path that never loaded as a concept", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			assert.isTrue(Option.isNone(conceptFor(bundle, `${ROOT}/missing.md`)));
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a bundle root with a trailing slash still resolves the same concept (positive control above)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const trailing = { ...bundle, root: `${bundle.root}/` };
			const found = conceptFor(trailing, `${ROOT}/a.md`);
			assert.isTrue(Option.isSome(found));
			assert.strictEqual(Option.getOrThrow(found).path, "a.md");
		}).pipe(Effect.provide(platform)),
	);

	it.effect("returns None for a path equal to the root itself (no relative file component)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			assert.isTrue(Option.isNone(conceptFor(bundle, ROOT)));
		}).pipe(Effect.provide(platform)),
	);

	it.effect(
		"returns None for a sibling directory that merely shares the root as a string prefix (`/x/okfoo/a.md` under `/x/okf`)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: ROOT });
				const sibling = `${ROOT}oo/a.md`;
				assert.isTrue(Option.isNone(conceptFor(bundle, sibling)));
			}).pipe(Effect.provide(platform)),
	);
});
