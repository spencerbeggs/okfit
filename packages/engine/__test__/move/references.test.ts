import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { LoadedBundle, LoadedConcept, PathField } from "@okfit/core";
import { Bundle, Graph, OkfitConfig } from "@okfit/core";
import { Effect, Layer, Path } from "effect";
import { referencesOf, rewriteReference } from "../../src/move/references.js";

const ROOT = "/repo/okf";
const doc = (type: string, title: string, extra = "", body = "") =>
	`---\ntype: ${type}\ntitle: ${title}\n${extra}---\n\n# ${title}\n\n${body}`;

const seed = {
	[`${ROOT}/decisions/a.md`]: doc("Decision", "A", "", "See [b](b.md).\n"),
	[`${ROOT}/decisions/b.md`]: doc("Decision", "B"),
	[`${ROOT}/conventions/c.md`]: doc("Convention", "C"),
	[`${ROOT}/conventions/index.md`]: "# Conventions\n",
	[`${ROOT}/publications/p.md`]: doc("Publication", "P", "renders:\n  - path: ../decisions/b.md\n"),
	[`${ROOT}/topics/rich.md`]: doc(
		"Decision",
		"Rich",
		'resource: ../decisions/b.md\nsupersedes: "b.md"\nsources:\n  - resource: ../conventions/c.md\n',
		[
			"Inline [x](b.md#why) and image ![img](../conventions/c.md).",
			"Self [b.md](b.md) text.",
			'Titled [t](b.md "b.md").',
			"",
			"[d]: ../conventions/c.md",
			"",
		].join("\n"),
	),
	[`${ROOT}/docs/my file.md`]: doc("Convention", "Spaced"),
	[`${ROOT}/topics/docs/my file.md`]: doc("Convention", "Shadow spaced"),
	[`${ROOT}/topics/conventions/c.md`]: doc("Convention", "Shadow"),
	[`${ROOT}/topics/titled.md`]: doc(
		"Decision",
		"Titled",
		"",
		['Link [x](b.md "see b.md here") and angle [y](<b.md> "b.md").', "", '[d]: b.md "b.md here"', ""].join("\n"),
	),
	[`${ROOT}/topics/blocky.md`]: doc("Decision", "Blocky", "resource: >\n  ../decisions/b.md\n", "x"),
	[`${ROOT}/topics/escaped.md`]: doc("Decision", "Escaped", 'supersedes: "b\\x2Emd"\n', "x"),
	[`${ROOT}/topics/urls.md`]: doc(
		"Decision",
		"Urls",
		"resource: https://x/y\n",
		"Auto <https://x.example/a> and [t](https://x/b.md) and mail <mailto:a@x.example>.\n\nNote[^1].\n\n[^1]: See <https://x.example/n>.\n",
	),
	[`${ROOT}/topics/list.md`]: doc(
		"Decision",
		"List",
		"supersedes:\n  - ../decisions/a.md\n  - '../decisions/b.md'\n",
		"Escaped [x](b\\_c.md).\n",
	),
};

const config: OkfitConfig = {
	...OkfitConfig.DEFAULTS,
	types: {
		Decision: { fields: { supersedes: { description: "Superseded.", kind: "path" } } },
		Convention: {},
		Publication: {},
	},
};

const platform = Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);
const load = Bundle.load({ root: ROOT }).pipe(Effect.provide(platform));
const conceptAt = (bundle: LoadedBundle, path: string): LoadedConcept => {
	const found = [...bundle.concepts.values()].find((c) => c.path === path);
	if (found === undefined) throw new Error(`no ${path}`);
	return found;
};

const moveB = (bundle: LoadedBundle, fromOld: string, raw: string, to: string, fromNew = fromOld) =>
	rewriteReference(raw, { bundle, fromOld, fromNew, movedFrom: "decisions/b.md", movedTo: to });

describe("rewriteReference", () => {
	it.effect("keeps each reference's spelling when the target moves", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const a = "decisions/a.md";
			assert.strictEqual(moveB(bundle, a, "b.md", "decisions/beta.md"), "beta.md");
			assert.strictEqual(moveB(bundle, a, "./b.md#why", "decisions/beta.md"), "./beta.md#why");
			assert.strictEqual(moveB(bundle, a, "b", "decisions/beta.md"), "beta");
			assert.strictEqual(moveB(bundle, a, "/decisions/b.md", "topics/beta.md"), "/topics/beta.md");
			assert.strictEqual(moveB(bundle, a, "decisions/b", "topics/beta.md"), "topics/beta");
			assert.strictEqual(moveB(bundle, "conventions/c.md", "../decisions/b.md", "topics/beta.md"), "../topics/beta.md");
			assert.strictEqual(
				moveB(bundle, "publications/p.md", "../decisions/b.md", "decisions/beta.md"),
				"../decisions/beta.md",
			);
			assert.strictEqual(moveB(bundle, a, "c.md", "topics/beta.md"), undefined);
			assert.strictEqual(moveB(bundle, a, "https://x/b.md", "topics/beta.md"), undefined);
			assert.strictEqual(moveB(bundle, a, "#top", "topics/beta.md"), undefined);
		}),
	);

	it.effect("recomputes the moved file's own outbound references", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const own = (raw: string) => moveB(bundle, "decisions/b.md", raw, "topics/deep/beta.md", "topics/deep/beta.md");
			assert.strictEqual(own("../conventions/c.md"), "../../conventions/c.md");
			assert.strictEqual(own("a.md"), "../../decisions/a.md");
			assert.strictEqual(own("/conventions/c.md"), undefined);
			assert.strictEqual(own("../../packages/core/src/x.ts"), "../../../packages/core/src/x.ts");
			assert.strictEqual(own("../conventions/"), "../../conventions/");
			assert.strictEqual(own("b.md#top"), "beta.md#top");
		}),
	);

	it.effect("respells a bare bundle-root reference rooted when the new location would retarget it", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const own = (raw: string, to: string) => moveB(bundle, "decisions/b.md", raw, to, to);
			// topics/conventions/c.md exists, so a bare `conventions/c` from topics/ would hit it first.
			assert.strictEqual(own("conventions/c", "topics/beta.md"), "/conventions/c");
			assert.strictEqual(own("conventions/c.md#x", "topics/beta.md"), "/conventions/c.md#x");
			assert.strictEqual(own("conventions/c", "other/beta.md"), undefined);
			// The author's own text is kept, percent-encoding included, never rebuilt from the decoded id.
			assert.strictEqual(moveB(bundle, "decisions/a.md", "docs/my%20file.md", "topics/beta.md"), undefined);
			assert.strictEqual(own("docs/my%20file.md", "other/beta.md"), undefined);
			assert.strictEqual(own("docs/my%20file.md#x", "topics/beta.md"), "/docs/my%20file.md#x");
			// A bare reference that still lands on its target stays bare when the target moves.
			assert.strictEqual(moveB(bundle, "decisions/a.md", "decisions/b", "topics/beta.md"), "topics/beta");
		}),
	);
});

describe("referencesOf", () => {
	it.effect("skips URL references entirely: none located, none unlocatable", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const { references, unlocatable } = referencesOf(conceptAt(bundle, "topics/urls.md"), config);
			assert.deepStrictEqual(unlocatable, []);
			assert.deepStrictEqual(references, []);
		}),
	);

	it.effect("locates every body and frontmatter reference at its exact text", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const rich = conceptAt(bundle, "topics/rich.md");
			const { references, unlocatable } = referencesOf(rich, config);
			assert.deepStrictEqual(unlocatable, []);
			const source = rich.document.source;
			for (const ref of references) assert.strictEqual(source.slice(ref.offset, ref.offset + ref.length), ref.raw);
			assert.deepStrictEqual(
				references.map((r) => `${r.raw}|${r.quote}|${r.field ?? ""}`),
				[
					"b.md#why||",
					"../conventions/c.md||",
					"b.md||",
					"b.md||",
					"../conventions/c.md||",
					"../decisions/b.md||resource",
					"../conventions/c.md||sources.resource",
					'b.md|"|',
				],
			);
			// The self-text link locates its destination (the second `b.md`), not its text.
			const selfLink = references.find((r) => source.slice(r.offset - 2, r.offset) === "](" && r.raw === "b.md");
			assert.isDefined(selfLink);
		}),
	);

	it.effect("locates the destination, never a title or the link text", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const titled = conceptAt(bundle, "topics/titled.md");
			const { references, unlocatable } = referencesOf(titled, config);
			assert.deepStrictEqual(unlocatable, []);
			const source = titled.document.source;
			const inline = source.indexOf("](b.md") + 2;
			const angle = source.indexOf("](<b.md>") + 3;
			const definition = source.indexOf("[d]: ") + 5;
			assert.deepStrictEqual(
				references.map((r) => r.offset),
				[inline, angle, definition],
			);
		}),
	);

	it.effect("reports a non-empty path value it cannot locate as unlocatable", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const blocky = referencesOf(conceptAt(bundle, "topics/blocky.md"), config);
			assert.deepStrictEqual(blocky.references, []);
			assert.deepStrictEqual(blocky.unlocatable, ["topics/blocky.md: ../decisions/b.md\n"]);
			const escaped = referencesOf(conceptAt(bundle, "topics/escaped.md"), config);
			assert.deepStrictEqual(escaped.references, []);
			assert.deepStrictEqual(escaped.unlocatable, ["topics/escaped.md: b.md"]);
		}),
	);

	it.effect("reads quoted, list-valued and renders paths, and reports an unlocatable link", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const list = referencesOf(conceptAt(bundle, "topics/list.md"), config);
			assert.deepStrictEqual(
				list.references.filter((r) => r.field === undefined && r.quote !== "").map((r) => [r.raw, r.quote]),
				[["../decisions/b.md", "'"]],
			);
			assert.isTrue(list.references.some((r) => r.raw === "../decisions/a.md" && r.quote === ""));
			assert.deepStrictEqual(list.unlocatable, ["topics/list.md: b_c.md"]);
			const pub = referencesOf(conceptAt(bundle, "publications/p.md"), config);
			assert.deepStrictEqual(
				pub.references.map((r) => r.raw),
				["../decisions/b.md"],
			);
		}),
	);
});

describe("rewriteReference with whitespace", () => {
	it.effect("rebases a spaced body path only when it sits inside angle brackets", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const options = {
				bundle,
				fromOld: "decisions/b.md",
				fromNew: "deep/er/b.md",
				movedFrom: "decisions/b.md",
				movedTo: "deep/er/b.md",
			};
			assert.strictEqual(rewriteReference("../docs/my file.md", { ...options, angle: true }), "../../docs/my file.md");
			assert.isUndefined(rewriteReference("../docs/my file.md", options));
			assert.isUndefined(
				rewriteReference("../docs/my file.md", { ...options, angle: true, field: "sources.resource" }),
			);
		}),
	);

	it.effect("flags an angle-bracketed link in referencesOf", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const { references } = referencesOf(conceptAt(bundle, "topics/titled.md"), config);
			assert.deepStrictEqual(
				references.map((r) => r.angle === true),
				[false, true, false],
			);
		}),
	);
});

const V3 = "/repo/okf3";
const FIELD_ORDER: ReadonlyArray<string> = [
	"resource",
	"sources.resource",
	"computation",
	"executor.resource",
	"attester.resource",
	"superseded_by",
];
const computationDoc = (extra: string) =>
	`---\ntype: Attested Computation\ntitle: Full\nruntime: bigquery\n${extra}---\n\n# Full\n`;
const FULL =
	"resource: ../references/check.py\ncomputation: ./q.sql\nexecutor:\n  resource: /references/run.md\n" +
	"attester:\n  resource: ../references/check.py\nsources:\n  resource: ./a.md\nstatus: deprecated\nsuperseded_by: /m/margin.md\n";
const v3Seed = {
	[`${V3}/index.md`]: '---\nokf_version: "0.3"\n---\n\n# Bundle\n',
	[`${V3}/m/full.md`]: computationDoc(FULL),
	[`${V3}/m/a.md`]: doc("Convention", "A"),
	[`${V3}/m/margin.md`]: doc("Convention", "Margin"),
	[`${V3}/m/q.sql`]: "select 1\n",
	[`${V3}/references/run.md`]: doc("Convention", "Run"),
	[`${V3}/references/check.py`]: "print('ok')\n",
	// The nested `attested` key does not exist in OKF 0.3: it must yield nothing.
	[`${V3}/m/nested.md`]: computationDoc(
		"attested:\n  computation: ./q.sql\n  attester:\n    resource: ../references/check.py\n",
	),
	[`${V3}/m/single.md`]: computationDoc("sources:\n  resource: ./a.md\n"),
	[`${V3}/m/listed.md`]: computationDoc("sources:\n  - resource: ./a.md\n  - resource: ./margin.md\n"),
	[`${V3}/m/custom.md`]: doc("Metric", "Custom", "owner: ./a.md\ncomputation: ./q.sql\nsuperseded_by: /m/margin.md\n"),
};
const loadV3 = Bundle.load({ root: V3 }).pipe(
	Effect.provide(Layer.mergeAll(MemoryFileSystem.layerWith(v3Seed), Path.layer)),
);
const customConfig: OkfitConfig = {
	...OkfitConfig.DEFAULTS,
	types: {
		Metric: {
			fields: {
				owner: { description: "Owner.", kind: "path" },
				computation: { description: "Declared like a core field.", kind: "path" },
				superseded_by: { description: "Declared like a core field.", kind: "path" },
			},
		},
	},
};

describe("referencesOf, OKF 0.3 path fields", () => {
	it.effect("lists every v0.3 path field, the computation keys at the top level included (OKF 0.3 6.2)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadV3;
			const { references, unlocatable } = referencesOf(conceptAt(bundle, "m/full.md"), config);
			assert.deepStrictEqual(unlocatable, []);
			assert.deepStrictEqual(
				references.map((r) => [r.field, r.raw]),
				[
					["resource", "../references/check.py"],
					["sources.resource", "./a.md"],
					["computation", "./q.sql"],
					["executor.resource", "/references/run.md"],
					["attester.resource", "../references/check.py"],
					["superseded_by", "/m/margin.md"],
				],
			);
			// Control: the nested `attested` key core never reads yields nothing.
			const nested = referencesOf(conceptAt(bundle, "m/nested.md"), config);
			assert.deepStrictEqual(nested.references, []);
			assert.deepStrictEqual(nested.unlocatable, []);
		}),
	);

	it.effect("rewrites a single-mapping and a list-valued `sources`", () =>
		Effect.gen(function* () {
			const bundle = yield* loadV3;
			const single = referencesOf(conceptAt(bundle, "m/single.md"), config).references;
			assert.deepStrictEqual(
				single.map((r) => [r.field, r.raw]),
				[["sources.resource", "./a.md"]],
			);
			const source = conceptAt(bundle, "m/single.md").document.source;
			const at = single[0];
			assert.strictEqual(source.slice(at?.offset, (at?.offset ?? 0) + (at?.length ?? 0)), "./a.md");
			const listed = referencesOf(conceptAt(bundle, "m/listed.md"), config).references;
			assert.deepStrictEqual(
				listed.map((r) => r.raw),
				["./a.md", "./margin.md"],
			);
		}),
	);

	it.effect("lists a declared field named like a core path field once", () =>
		Effect.gen(function* () {
			const bundle = yield* loadV3;
			const { references } = referencesOf(conceptAt(bundle, "m/custom.md"), customConfig);
			assert.deepStrictEqual(
				references.map((r) => [r.field ?? "(declared)", r.raw]),
				[
					["computation", "./q.sql"],
					["superseded_by", "/m/margin.md"],
					["(declared)", "./a.md"],
				],
			);
		}),
	);

	it.effect("lists exactly the path fields core reads, member for member", () =>
		Effect.gen(function* () {
			const bundle = yield* loadV3;
			const mine = referencesOf(conceptAt(bundle, "m/full.md"), config).references.map((r) => String(r.field));
			const core = Graph.fromBundle(bundle)
				.edges.filter((e) => e.from === "m/full" && e.data.source === "frontmatter")
				.map((e) => String(e.data.field));
			// Control: core's list is not empty, so an agreeing pair of empty lists cannot pass.
			assert.lengthOf(core, FIELD_ORDER.length);
			assert.deepStrictEqual([...mine].sort(), [...core].sort());
			assert.deepStrictEqual([...mine].sort(), [...FIELD_ORDER].sort());
		}),
	);

	it.effect("keeps a leading / rooted and a ./ or ../ value file-relative when the target moves", () =>
		Effect.gen(function* () {
			const bundle = yield* loadV3;
			const move = (field: PathField, raw: string) =>
				rewriteReference(raw, {
					bundle,
					fromOld: "m/full.md",
					fromNew: "m/full.md",
					movedFrom: "m/margin.md",
					movedTo: "n/gross.md",
					field,
				});
			assert.strictEqual(move("superseded_by", "/m/margin.md"), "/n/gross.md");
			// A value that does not name the moved concept is left alone (the control).
			assert.strictEqual(move("superseded_by", "/m/a.md"), undefined);
			assert.strictEqual(move("sources.resource", "./margin.md"), "../n/gross.md");
		}),
	);
});

describe("referencesOf, OKF 0.2 root fallback", () => {
	it.effect("rewrites a bare value that resolved only through the root fallback to one that resolves", () =>
		Effect.gen(function* () {
			const root = "/repo/okf2";
			const seed02 = {
				[`${root}/index.md`]: '---\nokf_version: "0.2"\n---\n\n# Bundle\n',
				[`${root}/computations/ytd.md`]: computationDoc(
					"sources:\n  resource: metrics/margin.md\nsuperseded_by: metrics/margin.md\n",
				),
				[`${root}/metrics/margin.md`]: doc("Convention", "Margin"),
			};
			const bundle = yield* Bundle.load({ root }).pipe(
				Effect.provide(Layer.mergeAll(MemoryFileSystem.layerWith(seed02), Path.layer)),
			);
			const refs = referencesOf(conceptAt(bundle, "computations/ytd.md"), config).references;
			assert.deepStrictEqual(
				refs.map((r) => [r.field, r.raw]),
				[
					["sources.resource", "metrics/margin.md"],
					["superseded_by", "metrics/margin.md"],
				],
			);
			// The same bundle after the move: the file under its new name.
			const { [`${root}/metrics/margin.md`]: moved, ...rest } = seed02;
			const afterMove = yield* Bundle.load({ root }).pipe(
				Effect.provide(
					Layer.mergeAll(MemoryFileSystem.layerWith({ ...rest, [`${root}/metrics/gross.md`]: moved }), Path.layer),
				),
			);
			for (const ref of refs) {
				const next = rewriteReference(ref.raw, {
					bundle,
					fromOld: "computations/ytd.md",
					fromNew: "computations/ytd.md",
					movedFrom: "metrics/margin.md",
					movedTo: "metrics/gross.md",
					...(ref.field === undefined ? {} : { field: ref.field }),
				});
				assert.strictEqual(next, "metrics/gross.md");
				const after = Graph.resolve(afterMove, "computations/ytd.md", next ?? "", ref.field);
				const kind = (r: ReturnType<typeof Graph.resolve>) => (r._tag === "node" ? r.kind : r._tag);
				assert.strictEqual(kind(after), "concept");
				// Control: the unrewritten value no longer resolves once the file has moved.
				assert.notStrictEqual(kind(Graph.resolve(afterMove, "computations/ytd.md", ref.raw, ref.field)), "concept");
			}
		}),
	);
});
