import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Bundle } from "@okfit/core";
import { Effect, FileSystem, Layer, Path, Result } from "effect";
import { DocumentPathError } from "../../src/errors.js";
import { provideDocuments, resolveDocumentPath } from "../../src/overlay/documents.js";
import { ROOT, SEED, moduleConcept, sourceOf } from "../utils/bundle.js";

const platform = Layer.mergeAll(MemoryFileSystem.layerWith(SEED), Path.layer);

describe("resolveDocumentPath", () => {
	it.effect("accepts a bundle-relative posix .md path and normalizes dot segments", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const resolved = resolveDocumentPath(path, ROOT, "sub/./a.md");
			if (Result.isFailure(resolved)) return assert.fail(`rejected: ${resolved.failure.reason}`);
			assert.strictEqual(resolved.success, `${ROOT}/sub/a.md`);
		}).pipe(Effect.provide(Path.layer)),
	);

	it.effect("rejects each malformed path with its own reason, and accepts a path that stays inside", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const reasonOf = (relative: string): string => {
				const resolved = resolveDocumentPath(path, ROOT, relative);
				return Result.isFailure(resolved) ? resolved.failure.reason : "accepted";
			};
			assert.strictEqual(reasonOf(""), "not-relative");
			assert.strictEqual(reasonOf("/etc/a.md"), "not-relative");
			assert.strictEqual(reasonOf("sub\\a.md"), "not-relative");
			assert.strictEqual(reasonOf("a.txt"), "not-markdown");
			assert.strictEqual(reasonOf("../a.md"), "escapes-bundle");
			assert.strictEqual(reasonOf("sub/../../a.md"), "escapes-bundle");
			assert.strictEqual(reasonOf("sub/../a.md"), "accepted");
		}).pipe(Effect.provide(Path.layer)),
	);
});

describe("provideDocuments", () => {
	it.effect("runs the wrapped program over the overlay and leaves disk untouched", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT }).pipe(
				provideDocuments(ROOT, [{ path: "a.md", text: moduleConcept("A", "DRAFT") }]),
			);
			assert.include(sourceOf(bundle, "a.md") ?? "", "DRAFT");
			const fs = yield* FileSystem.FileSystem;
			assert.notInclude(yield* fs.readFileString(`${ROOT}/a.md`), "DRAFT");
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a dot-segment spelling of an existing file still shadows it", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT }).pipe(
				provideDocuments(ROOT, [{ path: "./x/../a.md", text: moduleConcept("A", "DRAFT") }]),
			);
			assert.include(sourceOf(bundle, "a.md") ?? "", "DRAFT");
		}).pipe(Effect.provide(platform)),
	);

	it.effect("fails DocumentPathError before running the program for an escaping path", () =>
		Effect.gen(function* () {
			let ran = false;
			const program = Effect.sync(() => {
				ran = true;
			});
			const error = yield* Effect.flip(program.pipe(provideDocuments(ROOT, [{ path: "../x.md", text: "" }])));
			assert.instanceOf(error, DocumentPathError);
			assert.strictEqual(error.reason, "escapes-bundle");
			assert.strictEqual(error.message, 'document path "../x.md" resolves outside the bundle root');
			assert.isFalse(ran);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("rejects two entries that normalize to the same file", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Effect.void.pipe(
					provideDocuments(ROOT, [
						{ path: "a.md", text: "one" },
						{ path: "./a.md", text: "two" },
					]),
				),
			);
			assert.strictEqual(error.reason, "duplicate");
			assert.strictEqual(error.path, "./a.md");
		}).pipe(Effect.provide(platform)),
	);

	it.effect("rejects a document under a directory that does not exist, before running the program", () =>
		Effect.gen(function* () {
			let ran = false;
			const program = Effect.sync(() => {
				ran = true;
			});
			const error = yield* Effect.flip(
				program.pipe(provideDocuments(ROOT, [{ path: "newdir/x.md", text: moduleConcept("X") }])),
			);
			assert.instanceOf(error, DocumentPathError);
			assert.strictEqual(error.reason, "no-directory");
			assert.strictEqual(
				error.message,
				'document path "newdir/x.md" names a directory that does not exist in the bundle',
			);
			assert.isFalse(ran);
		}).pipe(Effect.provide(platform)),
	);

	it.effect(
		"rejects a doubled bundle prefix (okf/a.md under an okf root) as no-directory, echoing the input path",
		() =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					Effect.void.pipe(provideDocuments(ROOT, [{ path: "okf/a.md", text: moduleConcept("A") }])),
				);
				assert.strictEqual(error.reason, "no-directory");
				assert.strictEqual(error.path, "okf/a.md");
			}).pipe(Effect.provide(platform)),
	);

	it.effect("rejects a document whose parent path exists but is a file, not a directory", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Effect.void.pipe(provideDocuments(ROOT, [{ path: "a.md/x.md", text: moduleConcept("X") }])),
			);
			assert.strictEqual(error.reason, "no-directory");
		}).pipe(Effect.provide(platform)),
	);

	it.effect("accepts and walks a new file under an existing directory (positive control)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT }).pipe(
				provideDocuments(ROOT, [{ path: "c.md", text: moduleConcept("C") }]),
			);
			assert.include(bundle.files, "c.md");
			assert.include(sourceOf(bundle, "c.md") ?? "", "# C");
		}).pipe(Effect.provide(platform)),
	);
});
