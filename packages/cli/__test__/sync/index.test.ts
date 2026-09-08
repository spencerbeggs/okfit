import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { Concept, ConceptId, Derive, LoadedBundle, LoadedConcept, OKF_SPEC_VERSION } from "@okfit/core";
import { Effect, Layer, Option, Result } from "effect";
import { syncIndex } from "../../src/sync/index.js";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const emptyDocument = Result.getOrThrow(MarkdownDocument.parseResult(""));

const conceptAt = (relativePath: string, title: string): LoadedConcept =>
	LoadedConcept.make({
		id: Option.getOrThrow(ConceptId.normalize(relativePath)),
		path: relativePath,
		frontmatter: Concept.make({ type: "Decision", title, extensions: {}, raw: {} }),
		document: emptyDocument,
		computationBody: Option.none(),
	});

describe("syncIndex", () => {
	it.effect("writes a directory's index.md only when the rendered bytes differ from disk", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-index-")));
			try {
				const concept = conceptAt("widgets/thing.md", "Thing");
				const bundle = LoadedBundle.make({
					root,
					files: [concept.path],
					directories: ["widgets"],
					concepts: new Map([[concept.id, concept]]),
					indexes: new Map(),
					logs: new Map(),
					diagnostics: [],
				});
				const expectedRootIndex = Derive.renderIndex("", [], {
					okfVersion: OKF_SPEC_VERSION,
					subdirectories: ["widgets"],
				});
				const expectedWidgetsIndex = Derive.synthesizeIndex(bundle, "widgets");

				// `bundle.directories` only ever names a directory that already holds
				// a concept file (Bundle.load's own invariant) -- this in-memory
				// fixture has no real "widgets/thing.md" on disk, so the directory
				// is created here to match that invariant for the write itself.
				yield* Effect.promise(() => mkdir(join(root, "widgets"), { recursive: true }));

				// The root's index.md is absent -- counts as different (design §4).
				const first = yield* syncIndex(bundle, false);
				assert.deepStrictEqual([...first.written].sort(), ["index.md", "widgets/index.md"]);
				assert.deepStrictEqual(first.unchanged, []);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "index.md"), "utf8")), expectedRootIndex);
				assert.strictEqual(
					yield* Effect.promise(() => readFile(join(root, "widgets", "index.md"), "utf8")),
					expectedWidgetsIndex,
				);

				// Second run: both files already match -> unchanged, nothing written.
				const second = yield* syncIndex(bundle, false);
				assert.deepStrictEqual(second.written, []);
				assert.deepStrictEqual([...second.unchanged].sort(), ["index.md", "widgets/index.md"]);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("--dry-run computes the written/unchanged split without touching disk", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-index-dry-")));
			try {
				const concept = conceptAt("thing.md", "Thing");
				const bundle = LoadedBundle.make({
					root,
					files: [concept.path],
					directories: [],
					concepts: new Map([[concept.id, concept]]),
					indexes: new Map(),
					logs: new Map(),
					diagnostics: [],
				});
				const rendered = Derive.renderIndex("", [concept], { okfVersion: OKF_SPEC_VERSION, subdirectories: [] });
				// Pre-seed a matching index.md so THIS run is unchanged, and a
				// second stale write never happens under --dry-run.
				yield* Effect.promise(() => writeFile(join(root, "index.md"), rendered));

				const result = yield* syncIndex(bundle, true);
				assert.deepStrictEqual(result.written, []);
				assert.deepStrictEqual(result.unchanged, ["index.md"]);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "index.md"), "utf8")), rendered);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);
});
