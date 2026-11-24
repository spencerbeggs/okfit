import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Graph as EffectGraph, Layer, Option, Path } from "effect";
import { Bundle } from "../src/Bundle.js";
import type { ConceptId } from "../src/ConceptId.js";
import type { GraphLink } from "../src/Graph.js";
import { Graph } from "../src/Graph.js";
import { MOUNT, platform } from "./utils/fixtures.js";
import {
	BROKEN_ROOT,
	BrokenPlatform,
	ESCAPE_ROOT,
	EscapePlatform,
	REPEAT_ROOT,
	RepeatPlatform,
} from "./utils/graphSeeds.js";

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

	it.effect("ranges each frontmatter edge at its own field when the path repeats (okfit#353)", () =>
		Effect.gen(function* () {
			const graph = Graph.fromBundle(yield* Bundle.load({ root: REPEAT_ROOT }));
			const edges = graph.edges.filter((link) => link.from === "note" && link.data.source === "frontmatter");
			assert.deepStrictEqual(
				edges.map((link) => {
					const position = link.data.position;
					return [link.data.field, position?.line, position?.character, position?.length];
				}),
				[
					["resource", 3, 10, 9],
					["sources.resource", 5, 14, 9],
				],
			);
		}).pipe(Effect.provide(RepeatPlatform)),
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

describe("Graph.resolve", () => {
	const RESOLVE_ROOT = "/repo/resolve";
	const doc = (title: string) => `---\ntype: Note\ntitle: ${title}\n---\n\n# ${title}\n`;
	const seed = {
		[`${RESOLVE_ROOT}/decisions/a.md`]: doc("A"),
		[`${RESOLVE_ROOT}/decisions/b.md`]: doc("B"),
		[`${RESOLVE_ROOT}/conventions/c.md`]: doc("C"),
	};
	const platform = Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);
	const loaded = Bundle.load({ root: RESOLVE_ROOT });

	it.effect("reports which D-23 rule produced a node", () =>
		Effect.gen(function* () {
			const bundle = yield* loaded;
			assert.deepStrictEqual(Graph.resolve(bundle, "decisions/a.md", "b.md"), {
				_tag: "node",
				id: "decisions/b",
				kind: "concept",
				via: "file",
			});
			assert.deepStrictEqual(Graph.resolve(bundle, "decisions/a.md", "/conventions/c.md"), {
				_tag: "node",
				id: "conventions/c",
				kind: "concept",
				via: "rooted",
			});
			assert.deepStrictEqual(Graph.resolve(bundle, "decisions/a.md", "conventions/c"), {
				_tag: "node",
				id: "conventions/c",
				kind: "concept",
				via: "root",
			});
			assert.deepStrictEqual(Graph.resolve(bundle, "decisions/a.md", "../../src/x.ts"), { _tag: "external" });
			assert.deepStrictEqual(Graph.resolve(bundle, "decisions/a.md", "the git history", "sources.resource"), {
				_tag: "descriptor",
			});
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a missing node reports the via of the candidate it fell back to", () =>
		Effect.gen(function* () {
			const bundle = yield* loaded;
			assert.deepStrictEqual(Graph.resolve(bundle, "decisions/a.md", "nope.md"), {
				_tag: "node",
				id: "decisions/nope.md",
				kind: "missing",
				via: "file",
			});
			assert.deepStrictEqual(Graph.resolve(bundle, "decisions/a.md", "x/nope.md"), {
				_tag: "node",
				id: "x/nope.md",
				kind: "missing",
				via: "root",
			});
			assert.deepStrictEqual(Graph.resolve(bundle, "decisions/a.md", "/x/nope.md"), {
				_tag: "node",
				id: "x/nope.md",
				kind: "missing",
				via: "rooted",
			});
		}).pipe(Effect.provide(platform)),
	);
});

describe("Graph.fromBundle after a dropped sources entry", () => {
	it.effect("ranges the kept source's edge at its own YAML line, not its decoded index", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			const graph = Graph.fromBundle(bundle);
			const edges = graph.edges.filter((edge) => edge.from === "a" && edge.to === "b");
			assert.strictEqual(edges.length, 1);
			assert.strictEqual(edges[0]?.data.field, "sources.resource");
			assert.strictEqual(edges[0]?.data.position?.line, 4);
			assert.strictEqual(edges[0]?.data.position?.character, 14);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/a.md`]: "---\ntype: Note\nsources:\n  - title: no resource\n  - resource: b.md\n---\n",
					[`${MOUNT}/b.md`]: "---\ntype: Note\n---\n",
				}),
			),
		),
	);

	it.effect("superseded_by is a path field and a graph edge (OKF 0.3 §5.4, §6.2)", () =>
		Effect.gen(function* () {
			const graph = Graph.fromBundle(yield* Bundle.load({ root: MOUNT }));
			const edge = graph.edges.find((link) => link.data.field === "superseded_by");
			assert.strictEqual(edge?.from, "metrics/gross-margin-legacy");
			assert.strictEqual(edge?.to, "metrics/gross-margin");
			assert.strictEqual(edge?.data.position?.line, 3);
			assert.deepStrictEqual(
				graph.dangling().map((link) => [link.from, link.data.field]),
				[["metrics/old", "superseded_by"]],
			);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/metrics/gross-margin.md`]: "---\ntype: Metric\n---\n",
					[`${MOUNT}/metrics/gross-margin-legacy.md`]:
						"---\ntype: Metric\nstatus: deprecated\nsuperseded_by: /metrics/gross-margin.md\n---\n",
					[`${MOUNT}/metrics/old.md`]: "---\ntype: Metric\nstatus: deprecated\nsuperseded_by: ./gone.md\n---\n",
				}),
			),
		),
	);
});

describe("Graph version-gated root fallback", () => {
	const seed = (frontmatter?: string) => ({
		[`${MOUNT}/index.md`]: `${frontmatter === undefined ? "" : `---\n${frontmatter}\n---\n\n`}# Metric\n\n* [Revenue](metrics/revenue.md)\n`,
		[`${MOUNT}/metrics/revenue.md`]: "---\ntype: Metric\n---\n",
		[`${MOUNT}/computations/revenue-ytd.md`]:
			"---\ntype: Attested Computation\nruntime: bigquery\nattester:\n  resource: attesters/sql_equality.py\n---\n\nSee [revenue](metrics/revenue.md).\n",
		[`${MOUNT}/attesters/sql_equality.py`]: "",
	});
	const load = (frontmatter?: string) => Bundle.load({ root: MOUNT }).pipe(Effect.provide(platform(seed(frontmatter))));
	const from = "computations/revenue-ytd.md";

	for (const [label, frontmatter] of [
		["0.3", 'okf_version: "0.3"'],
		["an unparsable version", 'okf_version: "next"'],
	] as const) {
		it.effect(`does not fall back to the root for ${label}`, () =>
			Effect.gen(function* () {
				const bundle = yield* load(frontmatter);
				assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md"), {
					_tag: "node",
					id: "computations/metrics/revenue.md",
					kind: "missing",
					via: "file",
				});
				assert.deepStrictEqual(Graph.resolve(bundle, from, "/metrics/revenue.md"), {
					_tag: "node",
					id: "metrics/revenue",
					kind: "concept",
					via: "rooted",
				});
				assert.deepStrictEqual(Graph.resolve(bundle, from, "attesters/sql_equality.py", "attester.resource"), {
					_tag: "node",
					id: "computations/attesters/sql_equality.py",
					kind: "missing",
					via: "file",
				});
				assert.strictEqual(Graph.fromBundle(bundle).dangling().length, 2);
			}),
		);
	}

	for (const [label, frontmatter] of [
		["nothing declared", undefined],
		["0.2", 'okf_version: "0.2"'],
	] as const) {
		it.effect(`keeps the root fallback for ${label}`, () =>
			Effect.gen(function* () {
				const bundle = yield* load(frontmatter);
				assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md"), {
					_tag: "node",
					id: "metrics/revenue",
					kind: "concept",
					via: "root",
				});
				assert.deepStrictEqual(Graph.resolve(bundle, from, "attesters/sql_equality.py", "attester.resource"), {
					_tag: "node",
					id: "attesters/sql_equality.py",
					kind: "file",
					via: "root",
				});
				assert.strictEqual(Graph.fromBundle(bundle).dangling().length, 0);
			}),
		);
	}
});

describe("Graph.resolve under a stated rule", () => {
	const seed = (frontmatter?: string) => ({
		[`${MOUNT}/index.md`]: `${frontmatter === undefined ? "" : `---\n${frontmatter}\n---\n\n`}# Metric\n`,
		[`${MOUNT}/metrics/revenue.md`]: "---\ntype: Metric\n---\n",
		[`${MOUNT}/metrics/margin.md`]: "---\ntype: Metric\n---\n",
		[`${MOUNT}/attesters/sql_equality.py`]: "",
	});
	const load = (frontmatter?: string) => Bundle.load({ root: MOUNT }).pipe(Effect.provide(platform(seed(frontmatter))));
	const from = "metrics/margin.md";
	const root = { _tag: "node", id: "metrics/revenue", kind: "concept", via: "root" } as const;
	const missing = { _tag: "node", id: "metrics/metrics/revenue.md", kind: "missing", via: "file" } as const;
	const sibling = { _tag: "node", id: "metrics/revenue", kind: "concept", via: "file" } as const;

	for (const [label, frontmatter] of [
		["a 0.2 bundle", 'okf_version: "0.2"'],
		["an undeclared bundle", undefined],
	] as const) {
		it.effect(`${label}: current turns the root fallback off, legacy and declared keep it`, () =>
			Effect.gen(function* () {
				const bundle = yield* load(frontmatter);
				assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md", undefined, "current"), missing);
				assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md", undefined, "legacy"), root);
				assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md", undefined, "declared"), root);
				assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md"), root);
				for (const rule of ["declared", "legacy", "current"] as const) {
					assert.deepStrictEqual(Graph.resolve(bundle, from, "./revenue.md", undefined, rule), sibling);
				}
			}),
		);
	}

	it.effect("a 0.3 bundle: declared and current miss, legacy forces the root fallback on", () =>
		Effect.gen(function* () {
			const bundle = yield* load('okf_version: "0.3"');
			assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md"), missing);
			assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md", undefined, "current"), missing);
			assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md", undefined, "legacy"), root);
			assert.deepStrictEqual(Graph.resolve(bundle, from, "./revenue.md", undefined, "legacy"), sibling);
			// A path field takes the override too, and the cached index is not poisoned by an earlier override.
			assert.deepStrictEqual(Graph.resolve(bundle, from, "attesters/sql_equality.py", "attester.resource", "legacy"), {
				_tag: "node",
				id: "attesters/sql_equality.py",
				kind: "file",
				via: "root",
			});
			assert.deepStrictEqual(Graph.resolve(bundle, from, "metrics/revenue.md"), missing);
		}),
	);
});

const dep = (target: string, extra = "") =>
	`---\ntype: Note\nstatus: deprecated\nsuperseded_by: ${target}\n${extra}---\n`;
const note = (status?: string) => `---\ntype: Note\n${status === undefined ? "" : `status: ${status}\n`}---\n`;

describe("Graph.replacement", () => {
	it.effect("follows deprecated chains and stops on cycles, self-links and non-concepts (OKF 0.3 5.4)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			const of = (id: string) => Graph.replacement(bundle, id as ConceptId);
			assert.deepStrictEqual(of("a"), Option.some("c"));
			assert.deepStrictEqual(of("b"), Option.some("c"));
			for (const id of ["c", "loop-1", "self", "to-asset", "to-missing"]) assert.isTrue(Option.isNone(of(id)), id);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/a.md`]: dep("./b.md"),
					[`${MOUNT}/b.md`]: dep("/c.md"),
					[`${MOUNT}/c.md`]: note(),
					[`${MOUNT}/loop-1.md`]: dep("./loop-2.md"),
					[`${MOUNT}/loop-2.md`]: dep("./loop-1.md"),
					[`${MOUNT}/self.md`]: dep("./self.md"),
					[`${MOUNT}/to-asset.md`]: dep("./x.png"),
					[`${MOUNT}/x.png`]: "",
					[`${MOUNT}/to-missing.md`]: dep("./gone.md"),
				}),
			),
		),
	);

	it.effect("follows a chain longer than two and a cycle entered from outside it", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			const of = (id: string) => Graph.replacement(bundle, id as ConceptId);
			assert.deepStrictEqual(of("d1"), Option.some("end"));
			assert.deepStrictEqual(of("d3"), Option.some("end"));
			assert.isTrue(Option.isNone(of("x")));
			assert.isTrue(Option.isNone(of("loop-3")));
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/d1.md`]: dep("./d2.md"),
					[`${MOUNT}/d2.md`]: dep("./d3.md"),
					[`${MOUNT}/d3.md`]: dep("./end.md"),
					[`${MOUNT}/end.md`]: note("stable"),
					[`${MOUNT}/x.md`]: dep("./loop-1.md"),
					[`${MOUNT}/loop-1.md`]: dep("./loop-2.md"),
					[`${MOUNT}/loop-2.md`]: dep("./loop-3.md"),
					[`${MOUNT}/loop-3.md`]: dep("./loop-1.md"),
				}),
			),
		),
	);

	it.effect("treats a draft as the replacement, an unknown status as none, and a missing superseded_by as none", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			const of = (id: string) => Graph.replacement(bundle, id as ConceptId);
			assert.deepStrictEqual(of("to-draft"), Option.some("draft"));
			assert.isTrue(Option.isNone(of("to-bogus")));
			assert.isTrue(Option.isNone(of("bare-deprecated")));
			assert.isTrue(Option.isNone(of("not-in-bundle")));
			assert.isTrue(Option.isNone(of("draft")), "a current concept has no replacement");
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/to-draft.md`]: dep("./draft.md"),
					[`${MOUNT}/draft.md`]: note("draft"),
					[`${MOUNT}/to-bogus.md`]: dep("./bogus.md"),
					[`${MOUNT}/bogus.md`]: note("bogus"),
					[`${MOUNT}/bare-deprecated.md`]: note("deprecated"),
				}),
			),
		),
	);

	it.effect("resolves a bare v0.2 value through the root fallback", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			// `sub/old.md` writes a bare `new.md`: file-relative would be `sub/new.md` (absent); only the root fallback finds `new`.
			assert.deepStrictEqual(Graph.replacement(bundle, "sub/old" as ConceptId), Option.some("new"));
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/index.md`]: "---\nokf_version: '0.2'\n---\n",
					[`${MOUNT}/sub/old.md`]: dep("new.md"),
					[`${MOUNT}/new.md`]: note(),
				}),
			),
		),
	);

	it.effect("control: the same bare value in a v0.3 bundle does not use the root fallback", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.isTrue(Option.isNone(Graph.replacement(bundle, "sub/old" as ConceptId)));
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/index.md`]: "---\nokf_version: '0.3'\n---\n",
					[`${MOUNT}/sub/old.md`]: dep("new.md"),
					[`${MOUNT}/new.md`]: note(),
				}),
			),
		),
	);
});
