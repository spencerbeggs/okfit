import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { Concept, ConceptId, LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Effect, Layer, Option, Result } from "effect";
import { lintResources } from "../../src/validate/resources.js";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const emptyDocument = Result.getOrThrow(MarkdownDocument.parseResult(""));

type ConceptInput = Parameters<typeof Concept.make>[0];

const conceptAt = (path: string, fields: Omit<ConceptInput, "type" | "extensions" | "raw"> = {}): LoadedConcept =>
	LoadedConcept.make({
		id: Option.getOrThrow(ConceptId.normalize(path)),
		path,
		frontmatter: Concept.make({ type: "Module", extensions: {}, raw: {}, ...fields }),
		document: emptyDocument,
		computationBody: Option.none(),
	});

const bundleOf = (root: string, ...concepts: ReadonlyArray<LoadedConcept>): LoadedBundle =>
	LoadedBundle.make({
		root,
		files: concepts.map((c) => c.path),
		directories: [""],
		concepts: new Map(concepts.map((c) => [c.id, c])),
		indexes: new Map(),
		logs: new Map(),
		diagnostics: [],
	});

describe("validate/resources lintResources", () => {
	it.effect("returns [] and never touches the filesystem when source-resource-missing is off", () =>
		Effect.gen(function* () {
			const config: OkfitConfig = {
				...OkfitConfig.DEFAULTS,
				lint: { ...OkfitConfig.DEFAULTS.lint, source_resource_missing: "off" },
			};
			// Deliberately nonexistent root: if lintResources touched the filesystem at all
			// this would fail with a PlatformError instead of returning [].
			const bundle = bundleOf("/does/not/exist", conceptAt("thing.md", { resource: "../nope.yml" }));
			const diagnostics = yield* lintResources(bundle, config).pipe(Effect.provide(platform));
			assert.deepStrictEqual(diagnostics, []);
		}),
	);

	it.effect("flags a resource path that does not exist and accepts one that does", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-lint-resources-")));
			try {
				yield* Effect.promise(() => writeFile(join(root, "package.json"), "{}\n"));
				const bundle = bundleOf(
					root,
					conceptAt("thing.md", { resource: "../nope.yml" }),
					conceptAt("nested/other.md", { sources: [{ resource: "../package.json" }] }),
				);
				const diagnostics = yield* lintResources(bundle, OkfitConfig.DEFAULTS).pipe(Effect.provide(platform));
				assert.strictEqual(diagnostics.length, 1);
				assert.strictEqual(diagnostics[0]?.code, "source-resource-missing");
				assert.strictEqual(diagnostics[0]?.file, "thing.md");
				assert.include(diagnostics[0]?.message ?? "", '"../nope.yml"');
				assert.include(diagnostics[0]?.message ?? "", "thing.md");
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("resolves a bare path against the bundle root after the concept's directory (D-23 order)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-lint-resources-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "policies"), { recursive: true }));
				yield* Effect.promise(() => writeFile(join(root, "policies", "revenue.md"), "# Revenue\n"));
				const bundle = bundleOf(
					root,
					conceptAt("computations/ytd.md", { sources: [{ resource: "policies/revenue.md" }] }),
					conceptAt("computations/bad.md", { sources: [{ resource: "./policies/revenue.md" }] }),
				);
				const diagnostics = yield* lintResources(bundle, OkfitConfig.DEFAULTS).pipe(Effect.provide(platform));
				assert.deepStrictEqual(
					diagnostics.map((d) => d.file),
					["computations/bad.md"],
				);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("skips URL, prose and glob descriptor resources without ever resolving them", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-lint-resources-descriptors-")));
			try {
				const bundle = bundleOf(
					root,
					conceptAt("a.md", { resource: "https://x/y" }),
					conceptAt("b.md", { resource: "src/**" }),
					conceptAt("c.md", { sources: [{ resource: "the git history" }] }),
				);
				const diagnostics = yield* lintResources(bundle, OkfitConfig.DEFAULTS).pipe(Effect.provide(platform));
				assert.deepStrictEqual(diagnostics, []);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});
