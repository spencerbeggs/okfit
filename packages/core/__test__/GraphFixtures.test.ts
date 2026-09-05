import { assert, describe, it } from "@effect/vitest";
import { Effect, Graph as EffectGraph, Option } from "effect";
import { Bundle } from "../src/Bundle.js";
import { Graph } from "../src/Graph.js";
import { okfBundlePlatform } from "./utils/fixtures.js";

const AcmePlatform = okfBundlePlatform("acme_retail");
const ids = (nodes: ReadonlyArray<{ readonly id: string }>) => nodes.map((node) => node.id).sort();
const load = Effect.map(Bundle.load({ root: "/repo/okf/acme_retail" }), Graph.fromBundle);

describe("Graph over acme_retail", () => {
	it.effect("has no dangling edges; the attester .py is the only non-concept node", () =>
		Effect.gen(function* () {
			const graph = yield* load;
			assert.deepStrictEqual(graph.dangling(), []);
			assert.strictEqual(EffectGraph.nodeCount(graph.graph), 10);
			assert.deepStrictEqual(
				graph.nodes.filter((node) => node.kind !== "concept"),
				[{ id: "attesters/sql_equality.py", kind: "file" }],
			);
			assert.deepStrictEqual(Option.getOrUndefined(graph.node("attesters/sql_equality.py")), {
				id: "attesters/sql_equality.py",
				kind: "file",
			});
			assert.deepStrictEqual(ids(graph.predecessors("attesters/sql_equality.py")), [
				"computations/gross-margin-period",
				"computations/revenue-ytd",
			]);
			const edges = graph.edges.filter((link) => link.to === "attesters/sql_equality.py");
			assert.deepStrictEqual(
				edges.map((link) => [link.data.source, link.data.field, link.data.raw, link.data.position !== undefined]),
				[
					["frontmatter", "attester.resource", "attesters/sql_equality.py", true],
					["frontmatter", "attester.resource", "attesters/sql_equality.py", true],
				],
			);
		}).pipe(Effect.provide(AcmePlatform)),
	);

	it.effect("rooted body links and root-relative frontmatter fields both resolve to concepts", () =>
		Effect.gen(function* () {
			const graph = yield* load;
			assert.deepStrictEqual(ids(graph.successors("policies/revenue-recognition")), [
				"computations/gross-margin-period",
				"computations/revenue-ytd",
				"metrics/gross-margin",
				"metrics/revenue",
				"tables/orders",
			]);
			assert.deepStrictEqual(ids(graph.successors("computations/revenue-ytd")), [
				"attesters/sql_equality.py",
				"policies/revenue-recognition",
				"skills/run-on-bq",
				"tables/orders",
			]);
			assert.deepStrictEqual(ids(graph.successors("metrics/revenue")), [
				"computations/revenue-ytd",
				"policies/revenue-recognition",
			]);
		}).pipe(Effect.provide(AcmePlatform)),
	);
});
