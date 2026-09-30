import { assert, describe, it } from "@effect/vitest";
import { Timestamp } from "@okfit/core";
import type { ConceptSummary, QueryLink, QueryNeighbor } from "@okfit/engine";
import { Schema } from "effect";
import { humanQueryGet, humanQueryList, humanQueryNeighbors, queryListSummary } from "../../src/render/query.js";

const summary = (id: string, over: Partial<ConceptSummary> = {}): ConceptSummary => ({
	id,
	type: "Decision",
	title: `Title of ${id}`,
	description: null,
	status: "draft",
	tags: [],
	path: `${id}.md`,
	...over,
});

describe("humanQueryList", () => {
	it("prints one `<id>  <status>  <type>  <title>` line per concept, in input order", () => {
		assert.deepStrictEqual(humanQueryList([summary("a/x"), summary("b", { status: "stable", type: "Module" })]), [
			"a/x  draft  Decision  Title of a/x",
			"b  stable  Module  Title of b",
		]);
	});
	it("prints nothing for no concepts", () => {
		assert.deepStrictEqual(humanQueryList([]), []);
	});
});

describe("queryListSummary", () => {
	it("reads `<N> concepts in <root>`", () => {
		assert.strictEqual(queryListSummary(3, "okf"), "3 concepts in okf");
		assert.strictEqual(queryListSummary(1, "okf"), "1 concept in okf");
	});
});

describe("humanQueryGet", () => {
	it("prints the bare id, labelled fields, verified entries and links", () => {
		const at = Schema.decodeUnknownSync(Timestamp)("2026-09-07T00:00:00Z");
		const links: ReadonlyArray<QueryLink> = [
			{ to: "modules/core", kind: "concept", source: "body" },
			{ to: "gone", kind: "missing", source: "frontmatter", field: "supersedes" },
		];
		assert.deepStrictEqual(
			humanQueryGet({
				summary: summary("decisions/x", { tags: ["a", "b"] }),
				verified: [{ by: "human:ada", at }],
				links,
			}),
			[
				"decisions/x",
				"type: Decision",
				"title: Title of decisions/x",
				"status: draft",
				"tags: a, b",
				"path: decisions/x.md",
				"verified: human:ada at 2026-09-07T00:00:00Z",
				"links:",
				"  -> modules/core (concept, body)",
				"  -> gone (missing, frontmatter, supersedes)",
			],
		);
	});
	it("prints (none) for no tags and no links", () => {
		const lines = humanQueryGet({ summary: summary("p"), verified: [], links: [] });
		assert.include(lines, "tags: (none)");
		assert.deepStrictEqual(lines.slice(-2), ["links:", "  (none)"]);
		assert.isFalse(lines.some((l) => l.startsWith("verified:")));
	});
});

describe("humanQueryNeighbors", () => {
	const n = (id: string): QueryNeighbor => ({ id, kind: "concept", summary: null });
	it("lists outgoing and incoming", () => {
		assert.deepStrictEqual(humanQueryNeighbors({ outgoing: [n("a")], incoming: [n("b")] }), [
			"outgoing:",
			"  -> a (concept)",
			"incoming:",
			"  <- b (concept)",
		]);
	});
	it("prints (none) for empty sides", () => {
		assert.deepStrictEqual(humanQueryNeighbors({ outgoing: [], incoming: [] }), [
			"outgoing:",
			"  (none)",
			"incoming:",
			"  (none)",
		]);
	});
});
