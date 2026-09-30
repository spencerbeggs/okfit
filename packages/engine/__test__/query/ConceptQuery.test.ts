import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { LoadedBundle } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Effect, Layer } from "effect";
import { ConceptQuery } from "../../src/query/ConceptQuery.js";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const config = {
	...OkfitConfig.DEFAULTS,
	types: { Decision: {}, Module: {} },
	tags: { architecture: {}, dx: {} },
};

const A = "---\ntype: Decision\nstatus: draft\ntags: [architecture]\n---\n\n# A\n";
const B =
	"---\ntype: Decision\ntags: [architecture, dx]\nverified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\n---\n\n# B\n\nSee [a](a.md).\n";
const M = "---\ntype: Module\n---\n\n# M\n\nSee [gone](gone.md).\n";

const withBundle = <A, E>(body: (bundle: LoadedBundle) => Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-engine-query-")));
		try {
			yield* Effect.promise(async () => {
				await mkdir(join(root, "decisions"));
				await writeFile(join(root, "decisions", "a.md"), A);
				await writeFile(join(root, "decisions", "b.md"), B);
				await writeFile(join(root, "m.md"), M);
			});
			const bundle = yield* Bundle.load({ root });
			return yield* body(bundle);
		} finally {
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}
	}).pipe(Effect.provide(platform));

const ids = (concepts: ReadonlyArray<{ readonly id: string }>) => concepts.map((c) => c.id);

describe("ConceptQuery.list", () => {
	it.effect("returns every concept sorted by id for an empty filter", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				assert.deepStrictEqual(ids(yield* ConceptQuery.list(bundle, config, {})), ["decisions/a", "decisions/b", "m"]);
			}),
		),
	);

	it.effect("filters by type, tags (AND), status and verified", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const run = (filter: Parameters<typeof ConceptQuery.list>[2]) =>
					ConceptQuery.list(bundle, config, filter).pipe(Effect.map(ids));
				assert.deepStrictEqual(yield* run({ types: ["Decision"] }), ["decisions/a", "decisions/b"]);
				assert.deepStrictEqual(yield* run({ tags: ["architecture", "dx"] }), ["decisions/b"]);
				assert.deepStrictEqual(yield* run({ statuses: ["stable"] }), ["decisions/b", "m"]);
				assert.deepStrictEqual(yield* run({ verified: true }), ["decisions/b"]);
				assert.deepStrictEqual(yield* run({ verified: false }), ["decisions/a", "m"]);
			}),
		),
	);

	it.effect("fails on an undeclared type with a sorted valid list", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const error = yield* ConceptQuery.list(bundle, config, { types: ["Nope"] }).pipe(Effect.flip);
				assert.strictEqual(error._tag, "QueryUnknownVocabularyError");
				assert.strictEqual(error.kind, "type");
				assert.strictEqual(error.requested, "Nope");
				assert.deepStrictEqual(error.valid, ["Decision", "Module"]);
			}),
		),
	);

	it.effect("fails on an undeclared tag", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const error = yield* ConceptQuery.list(bundle, config, { tags: ["nope"] }).pipe(Effect.flip);
				assert.strictEqual(error.kind, "tag");
				assert.deepStrictEqual(error.valid, ["architecture", "dx"]);
			}),
		),
	);
});

describe("ConceptQuery.get", () => {
	it.effect("resolves a tolerant id and lists outgoing links", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const result = yield* ConceptQuery.get(bundle, "/decisions/b.md");
				assert.strictEqual(result.concept.id, "decisions/b");
				assert.deepStrictEqual(result.links, [{ to: "decisions/a", kind: "concept", source: "body" }]);
				const missing = yield* ConceptQuery.get(bundle, "m");
				assert.deepStrictEqual(
					missing.links.map((l) => l.kind),
					["missing"],
				);
			}),
		),
	);

	it.effect("fails with empty-id and not-a-concept", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const empty = yield* ConceptQuery.get(bundle, "").pipe(Effect.flip);
				assert.strictEqual(empty.reason, "empty-id");
				const nope = yield* ConceptQuery.get(bundle, "nope").pipe(Effect.flip);
				assert.strictEqual(nope.reason, "not-a-concept");
				assert.strictEqual(nope.id, "nope");
			}),
		),
	);
});

describe("ConceptQuery.neighbors", () => {
	it.effect("reports incoming concepts and null concepts for non-concept nodes", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const a = yield* ConceptQuery.neighbors(bundle, "decisions/a");
				assert.strictEqual(a.id, "decisions/a");
				assert.deepStrictEqual(ids(a.incoming), ["decisions/b"]);
				assert.strictEqual(a.incoming[0]?.concept?.id, "decisions/b");
				const m = yield* ConceptQuery.neighbors(bundle, "m");
				assert.strictEqual(m.outgoing.length, 1);
				assert.strictEqual(m.outgoing[0]?.concept, null);
				const error = yield* ConceptQuery.neighbors(bundle, "").pipe(Effect.flip);
				assert.strictEqual(error.reason, "empty-id");
			}),
		),
	);
});
