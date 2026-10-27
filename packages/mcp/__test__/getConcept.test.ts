import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";
import { assertConceptNotFound } from "./utils/notFound.js";

interface Link {
	readonly to: string;
	readonly kind: "concept" | "file" | "missing";
	readonly source: "body" | "frontmatter";
	readonly field?: string;
}
interface ConceptResult {
	readonly id: string;
	readonly type: string;
	readonly title: string;
	readonly path: string;
	readonly frontmatter: Record<string, unknown>;
	readonly raw: string;
	readonly links: ReadonlyArray<Link>;
	readonly tier: string;
	readonly integrity: string;
	readonly stale: boolean;
	readonly drift: {
		readonly reason: string;
		readonly edited_by: string | null;
		readonly edited_at: string | null;
	} | null;
}

const get = (id: string) =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject("project");
		const harness = yield* makeHarness(root);
		yield* harness.initialize;
		return yield* harness.callTool("get_concept", { id });
	});

describe("get_concept", () => {
	it.effect("returns frontmatter, raw text, path and links for a known id", () =>
		Effect.gen(function* () {
			const result = yield* get("metrics/revenue");
			assert.notOk(result.isError);
			const data = result.structuredContent as ConceptResult;
			assert.strictEqual(data.id, "metrics/revenue");
			assert.strictEqual(data.type, "Metric");
			assert.strictEqual(data.title, "Revenue");
			assert.strictEqual(data.path, "metrics/revenue.md");
			assert.strictEqual(data.frontmatter.type, "Metric");
			assert.ok(data.raw.length > 0);
			assert.ok(data.links.length > 0);
		}).pipe(Effect.scoped),
	);

	it.effect("reports the trust signal: a human-verified concept with no integrity is drifted/unbound", () =>
		Effect.gen(function* () {
			const data = (yield* get("metrics/revenue")).structuredContent as ConceptResult;
			assert.strictEqual(data.tier, "human-reviewed");
			assert.strictEqual(data.integrity, "drifted");
			assert.isBoolean(data.stale);
			assert.strictEqual(data.drift?.reason, "unbound");
		}).pipe(Effect.scoped),
	);

	it.effect("reports drift: null and integrity none for a concept nobody human-verified", () =>
		Effect.gen(function* () {
			const data = (yield* get("metrics/churn")).structuredContent as ConceptResult;
			assert.strictEqual(data.tier, "unverified");
			assert.strictEqual(data.integrity, "none");
			assert.strictEqual(data.drift, null);
		}).pipe(Effect.scoped),
	);

	it.effect("raw text includes the frontmatter block", () =>
		Effect.gen(function* () {
			const data = (yield* get("metrics/revenue")).structuredContent as ConceptResult;
			assert.ok(data.raw.startsWith("---\n"));
			assert.ok(data.raw.includes("type: Metric"));
		}).pipe(Effect.scoped),
	);

	it.effect("accepts a tolerant id with a leading slash, a trailing .md, or both", () =>
		Effect.gen(function* () {
			const plain = (yield* get("metrics/revenue")).structuredContent as ConceptResult;
			for (const variant of ["/metrics/revenue", "metrics/revenue.md", "/metrics/revenue.md"]) {
				const data = (yield* get(variant)).structuredContent as ConceptResult;
				assert.strictEqual(data.id, plain.id);
			}
		}).pipe(Effect.scoped),
	);

	it.effect("reports a frontmatter-sourced link with its field and a body-sourced link without one", () =>
		Effect.gen(function* () {
			const data = (yield* get("metrics/revenue")).structuredContent as ConceptResult;
			const frontmatterLink = data.links.find((link) => link.source === "frontmatter");
			const bodyLink = data.links.find((link) => link.source === "body");
			assert.ok(frontmatterLink !== undefined);
			assert.strictEqual(frontmatterLink?.field, "sources.resource");
			assert.ok(bodyLink !== undefined);
			assert.strictEqual(bodyLink?.field, undefined);
		}).pipe(Effect.scoped),
	);

	it.effect("reports a dangling link target with kind missing", () =>
		Effect.gen(function* () {
			const data = (yield* get("metrics/churn")).structuredContent as ConceptResult;
			const dangling = data.links.find((link) => link.to.includes("does-not-exist"));
			assert.ok(dangling !== undefined);
			assert.strictEqual(dangling?.kind, "missing");
		}).pipe(Effect.scoped),
	);

	// A typed tool failure never carries `structuredContent` on the wire under
	// `failureMode: "error"` (B1's ruling, progress.md): only `error.message`
	// reaches `tools/call`'s `content[0].text`. So this case (and the next)
	// assert on the composed wire text rather than on `structuredContent` — the
	// brief's literal snippet predates that discovery.
	it.effect("answers the ConceptNotFound envelope for an id with no matching concept, suggesting list_concepts", () =>
		Effect.gen(function* () {
			assertConceptNotFound(yield* get("metrics/nope"), {
				id: "metrics/nope",
				reason: "not-a-concept",
				messageIncludes: '"metrics/nope"',
			});
		}).pipe(Effect.scoped),
	);

	it.effect("answers the ConceptNotFound envelope with reason empty-id for an empty id", () =>
		Effect.gen(function* () {
			assertConceptNotFound(yield* get(""), { id: "", reason: "empty-id", messageIncludes: "id must not be empty" });
		}).pipe(Effect.scoped),
	);
});
