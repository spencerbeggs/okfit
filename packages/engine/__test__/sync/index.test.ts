import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { MemoryFileSystem } from "@effected/memfs";
import {
	Bundle,
	Concept,
	ConceptId,
	Derive,
	IndexDocument,
	LoadedBundle,
	LoadedConcept,
	OKF_SPEC_VERSION,
} from "@okfit/core";
import { Effect, FileSystem, Layer, Option, Path, Result } from "effect";
import { syncIndex } from "../../src/sync/index.js";
import { UNDECLARED_PROJECT, V02_PROJECT } from "../fixtures/bundles.js";
import { ROOT, projectPlatform } from "../utils/bundle.js";

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
				const expectedRootIndex = Derive.renderIndex("", [], { subdirectories: ["widgets"] });
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

	it.effect(
		"lists a directory holding only index.md (no concepts) in the root's Subdirectories, matching synthesizeIndex's own union (S-29)",
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-index-indexonly-")));
				try {
					// "empty" holds only an index.md -- Bundle.load never records such a
					// directory in `bundle.directories` (no concept lives there), but it
					// is still a key of `bundle.indexes`.
					const bundle = LoadedBundle.make({
						root,
						files: ["empty/index.md"],
						directories: [],
						concepts: new Map(),
						indexes: new Map([["empty", IndexDocument.make({ path: "empty/index.md", dir: "empty", sections: [] })]]),
						logs: new Map(),
						diagnostics: [],
					});
					const expectedRootIndex = Derive.renderIndex("", [], { subdirectories: ["empty"] });

					const result = yield* syncIndex(bundle, false);
					assert.deepStrictEqual(result.written, ["index.md"]);
					const written = yield* Effect.promise(() => readFile(join(root, "index.md"), "utf8"));
					assert.strictEqual(written, expectedRootIndex);
					assert.ok(written.includes("[empty](empty/index.md)"));
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}).pipe(Effect.provide(platform)),
	);

	it.effect("writes an index.md for an ancestor directory that holds no concept itself, only a nested directory", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-index-nested-")));
			try {
				const concept = conceptAt("topics/deep/thing.md", "Thing");
				const bundle = LoadedBundle.make({
					root,
					files: [concept.path],
					directories: ["topics/deep"],
					concepts: new Map([[concept.id, concept]]),
					indexes: new Map(),
					logs: new Map(),
					diagnostics: [],
				});
				yield* Effect.promise(() => mkdir(join(root, "topics", "deep"), { recursive: true }));
				const result = yield* syncIndex(bundle, false);
				assert.deepStrictEqual([...result.written].sort(), ["index.md", "topics/deep/index.md", "topics/index.md"]);
				const topics = yield* Effect.promise(() => readFile(join(root, "topics", "index.md"), "utf8"));
				assert.ok(topics.includes("deep/index.md"));
				assert.strictEqual(topics, Derive.synthesizeIndex(bundle, "topics"));
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
				const rendered = Derive.renderIndex("", [concept], { subdirectories: [] });
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

	it.effect("keeps a declared root frontmatter and never forces the spec constant over it (D6)", () => {
		const bareRoot = `${ROOT}/bare`;
		const handle = MemoryFileSystem.makeSync({
			[`${ROOT}/thing.md`]: "",
			[`${bareRoot}/thing.md`]: "",
		});
		const rootBundle = (root: string, frontmatter: string): LoadedBundle => {
			const concept = conceptAt("thing.md", "Thing");
			return LoadedBundle.make({
				root,
				files: [concept.path],
				directories: [],
				concepts: new Map([[concept.id, concept]]),
				indexes: new Map([
					["", IndexDocument.make({ path: "index.md", dir: "", sections: [], okfVersion: "0.3", frontmatter })],
				]),
				logs: new Map(),
				diagnostics: [],
			});
		};
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const declared = 'okf_version: "0.3"\ntitle: Acme retail analytics\nlicense: CC-BY-4.0';
			const bundle = rootBundle(ROOT, declared);
			const first = yield* syncIndex(bundle, false);
			assert.include(first.written, "index.md");
			const text = yield* fs.readFileString(`${ROOT}/index.md`);
			assert.isTrue(text.startsWith(`---\n${declared}\n---\n`));
			const second = yield* syncIndex(bundle, false);
			assert.include(second.unchanged, "index.md");
			assert.notInclude(second.written, "index.md");

			// control: a block declaring no okf_version gets the spec constant prepended and keeps its keys
			yield* syncIndex(rootBundle(bareRoot, "title: Acme"), false, undefined, OKF_SPEC_VERSION);
			const bare = yield* fs.readFileString(`${bareRoot}/index.md`);
			assert.match(bare, new RegExp(`^---\\nokf_version: ['"]${OKF_SPEC_VERSION}['"]\\ntitle: Acme\\n---\\n`));
		}).pipe(Effect.provide(Layer.mergeAll(handle.layer, Path.layer)));
	});

	const readRoot = Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return yield* fs.readFileString(`${ROOT}/index.md`);
	});

	it.effect("never stamps a version into an undeclared root unless the config names one (R4)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			yield* syncIndex(bundle, false);
			const bare = yield* readRoot;
			assert.isFalse(bare.includes("okf_version"));
			// control: the config key fills it
			yield* syncIndex(bundle, false, undefined, "0.3");
			assert.isTrue((yield* readRoot).startsWith(`---\nokf_version: '0.3'\n---\n`));
		}).pipe(Effect.provide(projectPlatform(UNDECLARED_PROJECT))),
	);

	it.effect("never rewrites a declared version, whatever the config says (D6)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const frontmatter = bundle.indexes.get("")?.frontmatter ?? "";
			assert.include(frontmatter, "okf_version: '0.2'");
			// the seed's body lags the rendered index, so the first run rewrites the body, never the declaration
			const first = yield* syncIndex(bundle, false, undefined, "0.3");
			assert.include(first.written, "index.md");
			const text = yield* readRoot;
			assert.isTrue(text.startsWith(`---\n${frontmatter}\n---\n`));
			assert.notInclude(text, "0.3");
			// control: the second run finds nothing to change, still with the config naming 0.3
			const reloaded = yield* Bundle.load({ root: ROOT });
			const second = yield* syncIndex(reloaded, false, undefined, "0.3");
			assert.include(second.unchanged, "index.md");
			assert.notInclude(second.written, "index.md");
		}).pipe(Effect.provide(projectPlatform(V02_PROJECT))),
	);
});
