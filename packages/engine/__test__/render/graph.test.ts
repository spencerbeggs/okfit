import { assert, describe, it } from "@effect/vitest";
import type { GraphLink, GraphNode } from "@okfit/core";
import { Effect, Schema } from "effect";
import { GraphEnvelope, graphEnvelope } from "../../src/render/graph.js";

const NODES: ReadonlyArray<GraphNode> = [
	{ id: "a", kind: "concept" },
	{ id: "docs/readme.md", kind: "file" },
	{ id: "docs/missing.md", kind: "missing" },
];

const EDGES: ReadonlyArray<GraphLink> = [
	{ from: "a", to: "docs/readme.md", data: { source: "frontmatter", field: "resource", raw: "docs/readme.md" } },
	{ from: "a", to: "docs/missing.md", data: { source: "body", raw: "docs/missing.md" } },
];

describe("graphEnvelope", () => {
	it.effect("builds a fully specified envelope, deepStrictEqual, snake_case, field omitted when absent", () =>
		Effect.sync(() => {
			const built = graphEnvelope({
				okfitVersion: "1.2.3",
				producer: "okfit",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: "software-project",
				nodes: NODES,
				edges: EDGES,
			});
			assert.deepStrictEqual(built, {
				schema: 1,
				okfit_version: "1.2.3",
				producer: "okfit",
				okf_version: "0.2",
				root: "/repo/okf",
				profile: "software-project",
				summary: { nodes: 3, edges: 2 },
				nodes: [
					{ id: "a", kind: "concept" },
					{ id: "docs/readme.md", kind: "file" },
					{ id: "docs/missing.md", kind: "missing" },
				],
				edges: [
					{ from: "a", to: "docs/readme.md", source: "frontmatter", field: "resource", raw: "docs/readme.md" },
					{ from: "a", to: "docs/missing.md", source: "body", raw: "docs/missing.md" },
				],
			});
			assert.isFalse(Object.hasOwn(built.edges[1] ?? {}, "field"));
		}),
	);

	it.effect("Schema.encodeSync(GraphEnvelope) round-trips through Schema.decodeUnknownSync", () =>
		Effect.sync(() => {
			const built = graphEnvelope({
				okfitVersion: "1.2.3",
				producer: "okfit",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: null,
				nodes: NODES,
				edges: EDGES,
			});
			const encoded = Schema.encodeSync(GraphEnvelope)(built);
			const decoded = Schema.decodeUnknownSync(GraphEnvelope)(encoded);
			assert.deepStrictEqual(decoded, built);
		}),
	);
});
