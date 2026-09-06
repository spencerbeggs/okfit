import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ConceptSummary } from "../src/index.js";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

interface Neighbor {
	readonly id: string;
	readonly kind: "concept" | "file" | "missing";
	readonly summary: ConceptSummary | null;
}
interface NeighborsResult {
	readonly outgoing: ReadonlyArray<Neighbor>;
	readonly incoming: ReadonlyArray<Neighbor>;
}

const neighbors = (id: string) =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject("project");
		const harness = yield* makeHarness(root);
		yield* harness.initialize;
		return yield* harness.callTool("concept_neighbors", { id });
	});

describe("concept_neighbors", () => {
	it.effect("splits outgoing and incoming neighbours correctly", () =>
		Effect.gen(function* () {
			const data = (yield* neighbors("metrics/revenue")).structuredContent as NeighborsResult;
			assert.ok(data.outgoing.some((n) => n.id === "policies/revenue-recognition"));
			assert.ok(data.incoming.every((n) => !data.outgoing.some((o) => o.id === n.id && o.kind === "missing")));
			assert.ok(data.incoming.length > 0);
		}).pipe(Effect.scoped),
	);

	it.effect("a concept-kind neighbour carries a full summary", () =>
		Effect.gen(function* () {
			const data = (yield* neighbors("metrics/revenue")).structuredContent as NeighborsResult;
			const conceptNeighbor = data.outgoing.find((n) => n.kind === "concept");
			assert.ok(conceptNeighbor !== undefined);
			assert.ok(conceptNeighbor?.summary !== null);
			assert.strictEqual(conceptNeighbor?.summary?.id, conceptNeighbor?.id);
			assert.ok((conceptNeighbor?.summary?.title.length ?? 0) > 0);
		}).pipe(Effect.scoped),
	);

	it.effect("a missing-kind neighbour carries a null summary and stays visible", () =>
		Effect.gen(function* () {
			const data = (yield* neighbors("metrics/churn")).structuredContent as NeighborsResult;
			const dangling = data.outgoing.find((n) => n.kind === "missing");
			assert.ok(dangling !== undefined);
			assert.strictEqual(dangling?.summary, null);
		}).pipe(Effect.scoped),
	);

	// A typed tool failure never carries `structuredContent` on the wire under
	// `failureMode: "error"` (B1's ruling, progress.md): only `error.message`
	// reaches `tools/call`'s `content[0].text`, so this asserts on the wire
	// text rather than on `structuredContent._tag`. This is the discriminating
	// case: `LinkGraph.successors`/`.predecessors` themselves return `[]` for
	// an unknown id, so a handler that skipped the lookup would return two
	// empty arrays and silently hide a caller mistake.
	it.effect("fails ConceptNotFound for an unknown id rather than returning empty arrays", () =>
		Effect.gen(function* () {
			const result = yield* neighbors("metrics/nope");
			assert.ok(result.isError);
			const text = result.content[0]?.text ?? "";
			assert.ok(text.includes('"metrics/nope"'));
			assert.ok(text.includes("Try list_concepts."));
		}).pipe(Effect.scoped),
	);
});
