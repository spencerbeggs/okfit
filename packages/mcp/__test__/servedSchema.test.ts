import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

describe("served schema", () => {
	it.effect("completes the initialize handshake", () =>
		Effect.gen(function* () {
			const root = yield* copyFixtureProject("project");
			const harness = yield* makeHarness(root);
			const response = yield* harness.initialize;
			assert.strictEqual((response.result as { serverInfo: { name: string } }).serverInfo.name, "okfit");
		}).pipe(Effect.scoped),
	);

	it.effect("serves the tools registered so far", () =>
		Effect.gen(function* () {
			const root = yield* copyFixtureProject("project");
			const harness = yield* makeHarness(root);
			yield* harness.initialize;
			const tools = yield* harness.listTools;
			assert.deepStrictEqual(tools.map((tool) => tool.name).toSorted(), [
				"concept_neighbors",
				"describe_vocabulary",
				"get_concept",
				"list_concepts",
				"stale_report",
				"validate_bundle",
			]);
		}).pipe(Effect.scoped),
	);
});
