import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import {
	QueryGetEnvelope,
	QueryListEnvelope,
	QueryNeighborsEnvelope,
	queryGetEnvelope,
	queryListEnvelope,
	queryNeighborsEnvelope,
	signalFor,
	toTrustDrift,
} from "../../src/render/query.js";

const summary = {
	id: "a",
	type: "Decision",
	title: "A",
	description: null,
	status: "stable" as const,
	raw_status: null,
	tags: ["x"],
	path: "a.md",
	tier: "human-reviewed" as const,
	integrity: "drifted" as const,
	stale: true,
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
			drift: { reason: "content-changed", edited_by: "human:ada", edited_at: "2026-09-01T00:00:00Z" },
			frontmatter: { type: "Decision" },
			links: [{ to: "b", kind: "concept", source: "frontmatter", field: "resource" }],
		});
		assert.deepStrictEqual(envelope.concept.frontmatter, { type: "Decision" });
		assert.strictEqual(envelope.concept.drift?.reason, "content-changed");
		assert.strictEqual(envelope.concept.integrity, "drifted");
		assert.deepStrictEqual(
			Schema.decodeSync(QueryGetEnvelope)(Schema.encodeSync(QueryGetEnvelope)(envelope)),
			envelope,
		);
	});

	it("get carries the replacement, null when none", () => {
		const base = { okfitVersion: "1.2.3", concept: summary, drift: null, frontmatter: {}, links: [] };
		const withIt = queryGetEnvelope({ ...base, replacement: "b" });
		assert.strictEqual(withIt.concept.replacement, "b");
		assert.strictEqual(Schema.encodeSync(QueryGetEnvelope)(withIt).concept.replacement, "b");
		assert.strictEqual(queryGetEnvelope(base).concept.replacement, null);
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

	it("toTrustDrift maps a drifted signal to snake_case and anything else to null", () => {
		assert.deepStrictEqual(
			toTrustDrift({
				tier: "human-reviewed",
				integrity: "drifted",
				stale: false,
				drift: { reason: "unbound" },
			}),
			{ reason: "unbound", edited_by: null, edited_at: null },
		);
		assert.strictEqual(toTrustDrift({ tier: "unverified", integrity: "none", stale: false }), null);
	});
});

describe("raw_status on the wire", () => {
	const unknown = { ...summary, status: "unknown" as const, raw_status: "archived" };
	it("round-trips a string raw_status and rejects an absent one", () => {
		const envelope = queryListEnvelope({ okfitVersion: "1.2.3", total: 2, items: [summary, unknown] });
		const encoded = Schema.encodeSync(QueryListEnvelope)(envelope);
		assert.deepStrictEqual(
			encoded.items.map((item) => item.raw_status),
			[null, "archived"],
		);
		const { raw_status: _dropped, ...withoutIt } = unknown;
		assert.throws(() => Schema.decodeUnknownSync(QueryListEnvelope)({ ...encoded, items: [withoutIt] }));
	});
});

describe("signalFor", () => {
	const signal = { tier: "unverified" as const, integrity: "none" as const, stale: false };
	it("returns the signal computed for the id", () => {
		assert.strictEqual(signalFor(new Map([["a", signal]]), "a"), signal);
	});
	it("dies naming the id when the signal is missing", () => {
		assert.throws(() => signalFor(new Map([["a", signal]]), "b"), /no trust signal computed for concept "b"/);
	});
});
