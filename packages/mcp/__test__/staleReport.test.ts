import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import type { ConceptSummary } from "../src/index.js";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

interface StaleItem {
	readonly summary: ConceptSummary;
	readonly stale_after: string;
	readonly days_past: number;
}
interface StaleResult {
	readonly as_of: string;
	readonly items: ReadonlyArray<StaleItem>;
}

const report = (args: Record<string, unknown>) =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject("project");
		const harness = yield* makeHarness(root);
		yield* harness.initialize;
		// it.effect provides TestClock, whose virtual clock starts at the epoch
		// (effect/testing/TestClock.ts:348-349); DateTime.now inside the handler
		// reads that same virtual clock, so an omitted `now` would otherwise
		// resolve to 1970-01-01 -- before every fixture concept's stale_after --
		// and the "current time" case (case 1) would never see a stale concept.
		yield* TestClock.setTime(Date.now());
		return yield* harness.callTool("stale_report", args);
	});

describe("stale_report", () => {
	it.effect("reports a concept whose stale_after is in the past, with its summary", () =>
		Effect.gen(function* () {
			const result = yield* report({});
			assert.notOk(result.isError);
			const data = result.structuredContent as StaleResult;
			const churn = data.items.find((item) => item.summary.id === "metrics/churn");
			assert.ok(churn !== undefined);
			assert.strictEqual(churn?.summary.title, "Churn");
		}).pipe(Effect.scoped),
	);

	it.effect("computes days_past against an explicit now", () =>
		Effect.gen(function* () {
			const data = (yield* report({ now: "2020-01-11T00:00:00Z" })).structuredContent as StaleResult;
			const churn = data.items.find((item) => item.summary.id === "metrics/churn");
			assert.strictEqual(churn?.days_past, 10);
			// DateTime.formatIso always writes milliseconds (Timestamp's own
			// encoder drops a zero component, but this handler formats directly),
			// verified live against this fixture (task brief Step 1).
			assert.strictEqual(churn?.stale_after, "2020-01-01T00:00:00.000Z");
		}).pipe(Effect.scoped),
	);

	it.effect("reports as_of as the instant actually used", () =>
		Effect.gen(function* () {
			const data = (yield* report({ now: "2020-01-11T00:00:00Z" })).structuredContent as StaleResult;
			assert.strictEqual(data.as_of, "2020-01-11T00:00:00.000Z");
		}).pipe(Effect.scoped),
	);

	it.effect("excludes a concept with no stale_after and a concept dated in the future", () =>
		Effect.gen(function* () {
			const data = (yield* report({ now: "2020-01-11T00:00:00Z" })).structuredContent as StaleResult;
			assert.deepStrictEqual(
				data.items.map((item) => item.summary.id),
				["metrics/churn"],
			);
		}).pipe(Effect.scoped),
	);

	// A typed tool failure never carries `structuredContent` on the wire under
	// `failureMode: "error"` (B1's ruling, progress.md): only `error.message`
	// reaches `tools/call`'s `content[0].text`. So this case asserts on the
	// composed wire text rather than on `structuredContent` — the brief's
	// literal snippet predates that discovery.
	it.effect("fails InvalidArgument for a now string with no explicit offset", () =>
		Effect.gen(function* () {
			const result = yield* report({ now: "2026-09-06T00:00:00" });
			assert.ok(result.isError);
			const text = result.content[0]?.text ?? "";
			assert.ok(text.includes("explicit offset"));
		}).pipe(Effect.scoped),
	);
});
