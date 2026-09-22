import { assert, describe, it } from "@effect/vitest";
import { Bundle } from "@okfit/core";
import { Effect, FileSystem, Option } from "effect";
import { OverlayDocuments } from "../../src/overlay/layer.js";
import { ROOT, SEED, moduleConcept, overlayPlatform, sourceOf } from "../utils/bundle.js";

describe("layerOverlayFileSystem", () => {
	it.effect("Bundle.load reads an open document's overlay text and disk for every other file", () => {
		const documents = OverlayDocuments.make();
		return Effect.gen(function* () {
			yield* documents.open(`${ROOT}/a.md`, moduleConcept("A", "UNSAVED EDIT"));
			const bundle = yield* Bundle.load({ root: ROOT });
			assert.include(sourceOf(bundle, "a.md") ?? "", "UNSAVED EDIT");
			assert.include(sourceOf(bundle, "b.md") ?? "", "# B");
			assert.notInclude(sourceOf(bundle, "b.md") ?? "", "UNSAVED EDIT");
		}).pipe(Effect.provide(overlayPlatform(SEED, documents)));
	});

	it.effect("with nothing open, Bundle.load reads disk (positive control for the overlay assertion)", () => {
		const documents = OverlayDocuments.make();
		return Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			assert.include(sourceOf(bundle, "a.md") ?? "", "See [B](b.md).");
			assert.notInclude(sourceOf(bundle, "a.md") ?? "", "UNSAVED EDIT");
		}).pipe(Effect.provide(overlayPlatform(SEED, documents)));
	});

	it.effect("close drops the overlay and the next read is disk again", () => {
		const documents = OverlayDocuments.make();
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* documents.open(`${ROOT}/a.md`, "DRAFT");
			assert.strictEqual(yield* fs.readFileString(`${ROOT}/a.md`), "DRAFT");
			yield* documents.close(`${ROOT}/a.md`);
			assert.strictEqual(yield* fs.readFileString(`${ROOT}/a.md`), moduleConcept("A", "See [B](b.md)."));
		}).pipe(Effect.provide(overlayPlatform(SEED, documents)));
	});

	it.effect("an overlay-only file under an existing directory is walked, stat'ed and read", () => {
		const documents = OverlayDocuments.make();
		return Effect.gen(function* () {
			yield* documents.open(`${ROOT}/c.md`, moduleConcept("C"));
			const bundle = yield* Bundle.load({ root: ROOT });
			assert.include(bundle.files, "c.md");
			assert.include(sourceOf(bundle, "c.md") ?? "", "# C");
			const fs = yield* FileSystem.FileSystem;
			assert.isTrue(yield* fs.exists(`${ROOT}/c.md`));
			assert.isFalse(yield* fs.exists(`${ROOT}/d.md`));
			const info = yield* fs.stat(`${ROOT}/c.md`);
			assert.strictEqual(info.type, "File");
		}).pipe(Effect.provide(overlayPlatform(SEED, documents)));
	});

	it.effect("readFile returns the overlay text as UTF-8 bytes", () => {
		const documents = OverlayDocuments.make();
		return Effect.gen(function* () {
			const text = moduleConcept("Café", "naïve résumé");
			yield* documents.open(`${ROOT}/a.md`, text);
			const fs = yield* FileSystem.FileSystem;
			const bytes = yield* fs.readFile(`${ROOT}/a.md`);
			assert.strictEqual(new TextDecoder().decode(bytes), text);
		}).pipe(Effect.provide(overlayPlatform(SEED, documents)));
	});

	it.effect("open starts at version 0, change bumps it, an explicit version wins", () =>
		Effect.gen(function* () {
			const documents = OverlayDocuments.make();
			const key = `${ROOT}/a.md`;
			yield* documents.open(key, "x");
			assert.strictEqual(Option.getOrThrow(yield* documents.get(key)).version, 0);
			yield* documents.change(key, "y");
			assert.deepStrictEqual(Option.getOrThrow(yield* documents.get(key)), { text: "y", version: 1 });
			yield* documents.change(key, "z", 7);
			assert.strictEqual(Option.getOrThrow(yield* documents.get(key)).version, 7);
			assert.strictEqual((yield* documents.entries()).length, 1);
		}),
	);
});
