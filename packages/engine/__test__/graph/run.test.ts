import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { runGraph } from "../../src/graph/run.js";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const A = `---\ntype: Module\nresource: b.md\n---\n\n# A\n\nSee [missing](missing.md).\n`;
const B = `---\ntype: Module\n---\n\n# B\n\nBody.\n`;

describe("runGraph", () => {
	it.effect("builds a LinkGraph over the loaded bundle: nodes, edges, dangling links", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-engine-graph-")));
			try {
				yield* Effect.promise(() => writeFile(join(root, "a.md"), A));
				yield* Effect.promise(() => writeFile(join(root, "b.md"), B));

				const result = yield* runGraph({ root });

				assert.strictEqual(result.bundle.concepts.size, 2);
				const nodeIds = result.graph.nodes.map((node) => node.id).toSorted();
				assert.deepStrictEqual(nodeIds, ["a", "b", "missing.md"]);
				assert.strictEqual(result.graph.edges.length, 2);
				assert.strictEqual(result.graph.dangling().length, 1);
				assert.isTrue(result.graph.toMermaid().length > 0);
				assert.isTrue(result.graph.toGraphViz().length > 0);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("an empty bundle yields an empty graph", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-engine-graph-empty-")));
			try {
				yield* Effect.promise(() => mkdir(root, { recursive: true }));
				const result = yield* runGraph({ root });
				assert.deepStrictEqual(result.graph.nodes, []);
				assert.deepStrictEqual(result.graph.edges, []);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);
});
