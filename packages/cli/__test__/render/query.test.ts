import { assert, describe, it } from "@effect/vitest";
import { Timestamp } from "@okfit/core";
import type { ConceptSummary, QueryLink, QueryNeighbor, TrustDrift } from "@okfit/engine";
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
	tier: "unverified",
	integrity: "none",
	stale: false,
	...over,
});

describe("humanQueryList", () => {
	it("prints one `<id>  <status>  <type>  <title>` line per concept, in input order", () => {
		assert.deepStrictEqual(humanQueryList([summary("a/x"), summary("b", { status: "stable", type: "Module" })]), [
			"a/x  draft  unverified  Decision  Title of a/x",
			"b  stable  unverified  Module  Title of b",
		]);
	});
	it("prints nothing for no concepts", () => {
		assert.deepStrictEqual(humanQueryList([]), []);
	});
	it("shows the tier in the trust column", () => {
		const cells = (["unverified", "machine-confirmed", "human-reviewed"] as const).map(
			(tier) => humanQueryList([summary("a", { tier })])[0],
		);
		assert.deepStrictEqual(cells, [
			"a  draft  unverified  Decision  Title of a",
			"a  draft  machine-confirmed  Decision  Title of a",
			"a  draft  human-reviewed  Decision  Title of a",
		]);
	});
	it("shows drifted in place of the tier when integrity is drifted", () => {
		assert.deepStrictEqual(humanQueryList([summary("a", { tier: "human-reviewed", integrity: "drifted" })]), [
			"a  draft  drifted  Decision  Title of a",
		]);
	});
	it("appends ,stale to the cell when stale", () => {
		assert.deepStrictEqual(
			humanQueryList([
				summary("a", { tier: "human-reviewed", stale: true }),
				summary("b", { tier: "human-reviewed", integrity: "drifted", stale: true }),
			]),
			["a  draft  human-reviewed,stale  Decision  Title of a", "b  draft  drifted,stale  Decision  Title of b"],
		);
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
				drift: null,
				verified: [{ by: "human:ada", at }],
				links,
			}),
			[
				"decisions/x",
				"type: Decision",
				"title: Title of decisions/x",
				"status: draft",
				"tier: unverified",
				"integrity: none",
				"stale: no",
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
		const lines = humanQueryGet({ summary: summary("p"), drift: null, verified: [], links: [] });
		assert.include(lines, "tags: (none)");
		assert.deepStrictEqual(lines.slice(-2), ["links:", "  (none)"]);
		assert.isFalse(lines.some((l) => l.startsWith("verified:")));
	});
});

describe("humanQueryGet trust lines", () => {
	const lines = (over: Partial<ConceptSummary>, drift: TrustDrift | null = null) =>
		humanQueryGet({ summary: summary("p", over), drift, verified: [], links: [] }).filter((l) =>
			/^(tier|integrity|stale):/.test(l),
		);
	it("reports a current binding", () => {
		assert.deepStrictEqual(lines({ tier: "human-reviewed", integrity: "current" }), [
			"tier: human-reviewed",
			"integrity: current",
			"stale: no",
		]);
	});
	it("reports drift with its reason", () => {
		assert.deepStrictEqual(
			lines(
				{ tier: "human-reviewed", integrity: "drifted", stale: true },
				{ reason: "unbound", edited_by: null, edited_at: null },
			),
			["tier: human-reviewed", "integrity: drifted (unbound)", "stale: yes"],
		);
	});
	it("names who edited and when for content-changed", () => {
		assert.deepStrictEqual(
			lines(
				{ integrity: "drifted" },
				{ reason: "content-changed", edited_by: "agent:claude", edited_at: "2026-09-08T00:00:00Z" },
			)[1],
			"integrity: drifted (content-changed; edited by agent:claude at 2026-09-08T00:00:00Z)",
		);
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
