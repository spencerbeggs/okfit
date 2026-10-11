import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ConceptSummary } from "../src/index.js";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

interface ListResult {
	readonly items: ReadonlyArray<ConceptSummary>;
	readonly total: number;
}

const list = (args: Record<string, unknown>, fixture: "project" | "missing-bundle" = "project") =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject(fixture);
		const harness = yield* makeHarness(root);
		yield* harness.initialize;
		return yield* harness.callTool("list_concepts", args);
	});

const ok = (result: { readonly isError?: boolean; readonly structuredContent?: unknown }): ListResult => {
	assert.notOk(result.isError);
	return result.structuredContent as ListResult;
};

describe("list_concepts", () => {
	it.effect("returns every concept with no filters and total equal to the bundle's concept count", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({}));
			assert.strictEqual(data.total, 10);
			assert.strictEqual(data.items.length, 10);
		}).pipe(Effect.scoped),
	);

	it.effect("filters by an exact type", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({ type: "Policy" }));
			assert.strictEqual(data.total, 2);
			assert.ok(data.items.every((item) => item.type === "Policy"));
		}).pipe(Effect.scoped),
	);

	it.effect("filters by tags with AND semantics, excluding a concept that carries only one of two requested tags", () =>
		Effect.gen(function* () {
			const both = ok(yield* list({ tags: ["finance", "revenue"] }));
			const one = ok(yield* list({ tags: ["finance"] }));
			assert.ok(both.total < one.total);
			assert.ok(both.items.every((item) => item.tags.includes("finance") && item.tags.includes("revenue")));
			assert.notOk(both.items.some((item) => item.id === "metrics/churn"));
		}).pipe(Effect.scoped),
	);

	it.effect("filters by status", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({ status: "draft" }));
			assert.deepStrictEqual(
				data.items.map((item) => item.id),
				["metrics/churn"],
			);
		}).pipe(Effect.scoped),
	);

	it.effect("combines type, tags and status", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({ type: "Metric", tags: ["finance"], status: "draft" }));
			assert.deepStrictEqual(
				data.items.map((item) => item.id),
				["metrics/churn"],
			);
		}).pipe(Effect.scoped),
	);

	it.effect("pages with limit and offset, keeping total constant and items disjoint", () =>
		Effect.gen(function* () {
			const first = ok(yield* list({ limit: 3, offset: 0 }));
			const second = ok(yield* list({ limit: 3, offset: 3 }));
			assert.strictEqual(first.total, second.total);
			assert.strictEqual(first.items.length, 3);
			assert.strictEqual(second.items.length, 3);
			const firstIds = new Set(first.items.map((item) => item.id));
			assert.notOk(second.items.some((item) => firstIds.has(item.id)));
		}).pipe(Effect.scoped),
	);

	it.effect("every summary carries tier, integrity and stale; human-verified fixture concepts are drifted", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({}));
			for (const item of data.items) {
				assert.include(["unverified", "machine-confirmed", "human-reviewed"], item.tier);
				assert.include(["current", "drifted", "none"], item.integrity);
				assert.isBoolean(item.stale);
			}
			const revenue = data.items.find((item) => item.id === "metrics/revenue");
			assert.strictEqual(revenue?.integrity, "drifted");
			assert.strictEqual(revenue?.tier, "human-reviewed");
		}).pipe(Effect.scoped),
	);

	it.effect("verified: true yields nothing (no concept is verified over its current content)", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({ verified: true }));
			assert.strictEqual(data.total, 0);
			assert.deepStrictEqual(data.items, []);
		}).pipe(Effect.scoped),
	);

	it.effect("verified: false yields only unverified-tier concepts", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({ verified: false }));
			assert.isAbove(data.total, 0);
			assert.ok(data.items.every((item) => item.tier === "unverified"));
			assert.notOk(data.items.some((item) => item.id === "metrics/revenue"));
		}).pipe(Effect.scoped),
	);

	it.effect("drifted: true yields every human-verified concept, all drifted", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({ drifted: true }));
			assert.isAbove(data.total, 0);
			assert.ok(data.items.every((item) => item.integrity === "drifted"));
			assert.ok(data.items.some((item) => item.id === "metrics/revenue"));
			assert.notOk(data.items.some((item) => item.id === "metrics/churn"));
		}).pipe(Effect.scoped),
	);

	it.effect("stale: true with an explicit now yields only the stale concept", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({ stale: true, now: "2020-01-11T00:00:00Z" }));
			assert.deepStrictEqual(
				data.items.map((item) => item.id),
				["metrics/churn"],
			);
			assert.isTrue(data.items[0]?.stale);
		}).pipe(Effect.scoped),
	);

	it.effect("fails with a hint for a malformed now", () =>
		Effect.gen(function* () {
			const result = yield* list({ stale: true, now: "2026-09-06T00:00:00" });
			assert.ok(result.isError);
			assert.ok((result.content[0]?.text ?? "").includes("explicit offset"));
		}).pipe(Effect.scoped),
	);

	it.effect("defaults limit to 200 and offset to 0", () =>
		Effect.gen(function* () {
			const bare = ok(yield* list({}));
			const explicit = ok(yield* list({ limit: 200, offset: 0 }));
			assert.deepStrictEqual(
				bare.items.map((item) => item.id),
				explicit.items.map((item) => item.id),
			);
		}).pipe(Effect.scoped),
	);

	// A typed tool failure never carries `structuredContent` on the wire under
	// `failureMode: "error"` (B1's ruling, progress.md): only `error.message`
	// reaches `tools/call`'s `content[0].text`. So this case (and the next)
	// assert on the composed wire text, not on a `structuredContent` object —
	// the brief's literal snippet predates that discovery; shaped per B1's own
	// `describeVocabulary.test.ts` ConfigError case.
	it.effect("fails UnknownVocabulary for an unrecognised type, listing the config's declared type names", () =>
		Effect.gen(function* () {
			const result = yield* list({ type: "Widget" });
			assert.ok(result.isError);
			assert.strictEqual(result.content.length, 1);
			assert.strictEqual(result.content[0]?.type, "text");
			const text = result.content[0]?.text ?? "";
			assert.ok(text.includes('"Widget"'));
			for (const name of ["Attested Computation", "BigQuery Table", "Dashboard", "Metric", "Policy", "Skill"]) {
				assert.ok(text.includes(name), `expected the message to list declared type "${name}"`);
			}
			assert.ok(text.includes("Try describe_vocabulary."));
		}).pipe(Effect.scoped),
	);

	it.effect("fails UnknownVocabulary on the first unrecognised tag among several valid ones", () =>
		Effect.gen(function* () {
			const result = yield* list({ tags: ["finance", "nope", "alsonope"] });
			assert.ok(result.isError);
			const text = result.content[0]?.text ?? "";
			assert.ok(text.includes('"nope"'));
			assert.notOk(text.includes("alsonope"));
		}).pipe(Effect.scoped),
	);

	it.effect("returns an empty items array for a declared but unused type", () =>
		Effect.gen(function* () {
			const data = ok(yield* list({ type: "Dashboard" }));
			assert.strictEqual(data.total, 0);
			assert.deepStrictEqual(data.items, []);
		}).pipe(Effect.scoped),
	);

	it.effect("fails BundleNotFound when the config's bundle path does not exist", () =>
		Effect.gen(function* () {
			const result = yield* list({}, "missing-bundle");
			assert.ok(result.isError);
			const text = result.content[0]?.text ?? "";
			assert.ok(text.includes("no-such-bundle"));
		}).pipe(Effect.scoped),
	);
});
