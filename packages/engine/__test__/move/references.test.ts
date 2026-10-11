import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { LoadedBundle, LoadedConcept } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
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
	[`${ROOT}/topics/conventions/c.md`]: doc("Convention", "Shadow"),
	[`${ROOT}/topics/titled.md`]: doc(
		"Decision",
		"Titled",
		"",
		['Link [x](b.md "see b.md here") and angle [y](<b.md> "b.md").', "", '[d]: b.md "b.md here"', ""].join("\n"),
	),
	[`${ROOT}/topics/blocky.md`]: doc("Decision", "Blocky", "resource: >\n  ../decisions/b.md\n", "x"),
	[`${ROOT}/topics/escaped.md`]: doc("Decision", "Escaped", 'supersedes: "b\\x2Emd"\n', "x"),
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
			// A bare reference that still lands on its target stays bare when the target moves.
			assert.strictEqual(moveB(bundle, "decisions/a.md", "decisions/b", "topics/beta.md"), "topics/beta");
		}),
	);
});

describe("referencesOf", () => {
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
