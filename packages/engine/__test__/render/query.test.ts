import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import {
	QueryGetEnvelope,
	QueryListEnvelope,
	QueryNeighborsEnvelope,
	queryGetEnvelope,
	queryListEnvelope,
	queryNeighborsEnvelope,
} from "../../src/render/query.js";

const summary = {
	id: "a",
	type: "Decision",
	title: "A",
	description: null,
	status: "stable" as const,
	tags: ["x"],
	path: "a.md",
};

describe("query envelopes", () => {
	it("list round-trips through its schema", () => {
		const envelope = queryListEnvelope({ okfitVersion: "1.2.3", total: 1, items: [summary] });
		assert.strictEqual(envelope.distribution, null);
		assert.strictEqual(envelope.total, 1);
		assert.deepStrictEqual(
			Schema.decodeSync(QueryListEnvelope)(Schema.encodeSync(QueryListEnvelope)(envelope)),
			envelope,
		);
	});

	it("get round-trips and carries distribution", () => {
		const envelope = queryGetEnvelope({
			okfitVersion: "1.2.3",
			distribution: { name: "@okfit/plugin", version: "9.9.9" },
			concept: summary,
			frontmatter: { type: "Decision" },
			links: [{ to: "b", kind: "concept", source: "frontmatter", field: "resource" }],
		});
		assert.deepStrictEqual(envelope.concept.frontmatter, { type: "Decision" });
		assert.deepStrictEqual(
			Schema.decodeSync(QueryGetEnvelope)(Schema.encodeSync(QueryGetEnvelope)(envelope)),
			envelope,
		);
	});

	it("neighbors round-trips", () => {
		const envelope = queryNeighborsEnvelope({
			okfitVersion: "1.2.3",
			id: "a",
			outgoing: [{ id: "gone.md", kind: "missing", summary: null }],
			incoming: [{ id: "b", kind: "concept", summary }],
		});
		assert.deepStrictEqual(
			Schema.decodeSync(QueryNeighborsEnvelope)(Schema.encodeSync(QueryNeighborsEnvelope)(envelope)),
			envelope,
		);
	});
});
