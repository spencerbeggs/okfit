import { assert, describe, it } from "@effect/vitest";
import { Effect, Graph as EffectGraph, Option } from "effect";
import { Bundle } from "../src/Bundle.js";
import type { GraphLink } from "../src/Graph.js";
import { Graph } from "../src/Graph.js";
import { BROKEN_ROOT, BrokenPlatform, ESCAPE_ROOT, EscapePlatform } from "./utils/graphSeeds.js";

const ids = (nodes: ReadonlyArray<{ readonly id: string }>) => nodes.map((node) => node.id).sort();
const byEdge = (a: GraphLink, b: GraphLink) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`);
const load = Effect.map(Bundle.load({ root: BROKEN_ROOT }), Graph.fromBundle);
const loadEscape = Effect.map(Bundle.load({ root: ESCAPE_ROOT }), Graph.fromBundle);

describe("Graph.fromBundle", () => {
	it.effect("adds every concept, referenced file, and missing placeholder as a node", () =>
		Effect.gen(function* () {
			const graph = yield* load;
			assert.deepStrictEqual(graph.nodes.map((node) => `${node.kind}:${node.id}`).sort(), [
				"concept:notes/a",
				"concept:notes/b",
				"file:notes/data.csv",
				"file:notes/index.md",
				"file:notes/nofm.md",
				"missing:assets/schema.json",
				"missing:lib/query.sql",
				"missing:notes/check.py",
				"missing:notes/gone.md",
				"missing:skills/run.md",
			]);
			assert.strictEqual(EffectGraph.nodeCount(graph.graph), 10);
			assert.strictEqual(graph.index.size, 10);
			assert.strictEqual(graph.edges.length, 11);
		}).pipe(Effect.provide(BrokenPlatform)),
	);

	it.effect("dangling() lists only edges into missing nodes, with field, raw, and position", () =>
		Effect.gen(function* () {
			const graph = yield* load;
			const dangling = [...graph.dangling()].sort(byEdge);
			assert.deepStrictEqual(
				dangling.map((link) => [link.from, link.to, link.data.source, link.data.field ?? null, link.data.raw]),
				[
					["notes/a", "assets/schema.json", "frontmatter", "resource", "assets/schema.json"],
					["notes/a", "notes/gone.md", "body", null, "./gone.md"],
					["notes/b", "lib/query.sql", "frontmatter", "computation", "lib/query.sql"],
					["notes/b", "notes/check.py", "frontmatter", "attester.resource", "check.py"],
					["notes/b", "skills/run.md", "frontmatter", "executor.resource", "skills/run.md"],
				],
			);
			const resource = dangling[0]!.data.position!;
			assert.deepStrictEqual([resource.offset, resource.length, resource.line, resource.character], [25, 18, 2, 10]);
			const gone = dangling[1]!.data.position!;
			assert.deepStrictEqual([gone.length, gone.line, gone.character], [17, 12, 0]);
		}).pipe(Effect.provide(BrokenPlatform)),
	);

	it.effect("successors/predecessors are unique, [] for unknown ids; node() is an Option; Mermaid/DOT render", () =>
		Effect.gen(function* () {
			const graph = yield* load;
			assert.deepStrictEqual(ids(graph.successors("notes/a")), [
				"assets/schema.json",
				"notes/b",
				"notes/data.csv",
				"notes/gone.md",
				"notes/index.md",
				"notes/nofm.md",
			]);
			assert.deepStrictEqual(ids(graph.predecessors("notes/b")), ["notes/a"]);
			assert.deepStrictEqual(ids(graph.predecessors("notes/a")), ["notes/b"]);
			assert.deepStrictEqual(graph.successors("nope"), []);
			assert.deepStrictEqual(graph.predecessors("nope"), []);
			assert.isTrue(Option.isNone(graph.node("nope")));
			assert.deepStrictEqual(Option.getOrUndefined(graph.node("notes/data.csv")), {
				id: "notes/data.csv",
				kind: "file",
			});
			const mermaid = graph.toMermaid();
			assert.isTrue(mermaid.startsWith("flowchart TD\n"));
			assert.include(mermaid, '["notes/a"]');
			assert.include(mermaid, '-->|"resource"|');
			assert.include(graph.toMermaid({ direction: "LR", edgeLabel: (edge) => edge.raw }), '-->|"./gone.md"|');
			assert.isTrue(graph.toGraphViz().startsWith('digraph "G" {'));
		}).pipe(Effect.provide(BrokenPlatform)),
	);

	it.effect("a resource that escapes the bundle root is external: no node, no dangling edge (F-18)", () =>
		Effect.gen(function* () {
			const graph = yield* loadEscape;
			assert.deepStrictEqual(graph.nodes.map((node) => `${node.kind}:${node.id}`).sort(), [
				"concept:modules/x",
				"concept:modules/y",
				"concept:modules/z",
				"concept:project",
				"missing:modules/missing.md",
			]);
			assert.deepStrictEqual(
				[...graph.dangling()].sort(byEdge).map((link) => [link.from, link.to, link.data.raw]),
				[["modules/y", "modules/missing.md", "missing.md"]],
			);
			assert.deepStrictEqual(ids(graph.successors("modules/z")), ["modules/x"]);
			assert.strictEqual(graph.edges.length, 2);
		}).pipe(Effect.provide(EscapePlatform)),
	);
});
