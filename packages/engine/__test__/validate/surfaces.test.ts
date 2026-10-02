import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { Concept, ConceptId, LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Effect, FileSystem, Layer, Option, Result } from "effect";
import { lintSurfaces } from "../../src/validate/surfaces.js";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const emptyDocument = Result.getOrThrow(MarkdownDocument.parseResult(""));

const surfaceAt = (path: string, resource: string): LoadedConcept =>
	LoadedConcept.make({
		id: Option.getOrThrow(ConceptId.normalize(path)),
		path,
		frontmatter: Concept.make({ type: "Surface", extensions: {}, raw: {}, resource }),
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

/** A repo with an `okf/` bundle root; `setup` creates directories under the repo. */
const withRepo = <A, E, R>(
	setup: (repo: string) => Promise<void>,
	body: (bundleRoot: string) => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const repo = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-lint-surfaces-")));
		try {
			yield* Effect.promise(async () => {
				await mkdir(join(repo, "okf", "surfaces"), { recursive: true });
				await setup(repo);
			});
			return yield* body(join(repo, "okf"));
		} finally {
			yield* Effect.promise(() => rm(repo, { recursive: true, force: true }));
		}
	});

describe("validate/surfaces lintSurfaces", () => {
	it.effect("silent when the glob matches a directory", () =>
		withRepo(
			(repo) => mkdir(join(repo, "packages", "a"), { recursive: true }).then(() => undefined),
			(root) =>
				Effect.gen(function* () {
					const bundle = bundleOf(root, surfaceAt("surfaces/pkgs.md", "../../packages/*"));
					const diagnostics = yield* lintSurfaces(bundle, OkfitConfig.DEFAULTS).pipe(Effect.provide(platform));
					assert.deepStrictEqual(diagnostics, []);
				}),
		),
	);

	it.effect("warns surface-unmatched when the glob matches nothing", () =>
		withRepo(
			(repo) => mkdir(join(repo, "packages"), { recursive: true }).then(() => undefined),
			(root) =>
				Effect.gen(function* () {
					const bundle = bundleOf(root, surfaceAt("surfaces/pkgs.md", "../../packages/*"));
					const diagnostics = yield* lintSurfaces(bundle, OkfitConfig.DEFAULTS).pipe(Effect.provide(platform));
					assert.strictEqual(diagnostics.length, 1);
					assert.strictEqual(diagnostics[0]?.code, "surface-unmatched");
					assert.strictEqual(diagnostics[0]?.severity, "warning");
					assert.strictEqual(diagnostics[0]?.file, "surfaces/pkgs.md");
					assert.include(diagnostics[0]?.message ?? "", '"../../packages/*"');
				}),
		),
	);

	it.effect("warns, not fails, when the static prefix does not exist", () =>
		withRepo(
			async () => undefined,
			(root) =>
				Effect.gen(function* () {
					const bundle = bundleOf(root, surfaceAt("surfaces/pkgs.md", "../../packages/*"));
					const diagnostics = yield* lintSurfaces(bundle, OkfitConfig.DEFAULTS).pipe(Effect.provide(platform));
					assert.strictEqual(diagnostics.length, 1);
					assert.strictEqual(diagnostics[0]?.code, "surface-unmatched");
				}),
		),
	);

	it.effect("ignores literal resources (source-resource-missing owns them)", () =>
		withRepo(
			async () => undefined,
			(root) =>
				Effect.gen(function* () {
					const bundle = bundleOf(root, surfaceAt("surfaces/docs.md", "../../docs"));
					const diagnostics = yield* lintSurfaces(bundle, OkfitConfig.DEFAULTS).pipe(Effect.provide(platform));
					assert.deepStrictEqual(diagnostics, []);
				}),
		),
	);

	it.effect("returns [] and makes no fs call when surface_unmatched is off", () =>
		Effect.gen(function* () {
			const config: OkfitConfig = {
				...OkfitConfig.DEFAULTS,
				lint: { ...OkfitConfig.DEFAULTS.lint, surface_unmatched: "off" },
			};
			const bundle = bundleOf("/does/not/exist", surfaceAt("surfaces/pkgs.md", "../../packages/*"));
			const diagnostics = yield* lintSurfaces(bundle, config).pipe(
				Effect.provide(Layer.mergeAll(FileSystem.layerNoop({}), NodePath.layer)),
			);
			assert.deepStrictEqual(diagnostics, []);
		}),
	);
});
