import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

/**
 * The fixture bundle's concept ids, one static resource each (Ruling,
 * task C4). Kept as a literal list rather than re-deriving it from the
 * bundle: a change here should be a deliberate, visible edit to this test,
 * not a silent pass-through of whatever the loader currently produces.
 */
const FIXTURE_CONCEPT_IDS = [
	"computations/gross-margin-period",
	"computations/revenue-ytd",
	"metrics/churn",
	"metrics/gross-margin",
	"metrics/gross-margin-legacy",
	"metrics/revenue",
	"policies/margin-standard",
	"policies/revenue-recognition",
	"skills/run-on-bq",
	"tables/orders",
];

const open = (fixture: "project" | "missing-bundle" = "project") =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject(fixture);
		const harness = yield* makeHarness(root);
		yield* harness.initialize;
		return { root, harness };
	});

describe("resources", () => {
	it.effect("lists a static resource for every fixture concept, plus okf://index", () =>
		Effect.gen(function* () {
			const { harness } = yield* open();
			const resources = yield* harness.listResources;
			const uris = resources.map((resource) => resource.uri);
			assert.ok(uris.includes("okf://index"));
			for (const id of FIXTURE_CONCEPT_IDS) {
				assert.ok(uris.includes(`okf://concept/${id}`), `missing okf://concept/${id}`);
			}
			assert.strictEqual(uris.length, FIXTURE_CONCEPT_IDS.length + 1);
		}).pipe(Effect.scoped),
	);

	it.effect("reads okf://index as the fixture bundle's root index.md verbatim", () =>
		Effect.gen(function* () {
			const { root, harness } = yield* open();
			const expected = readFileSync(join(root, "bundle", "index.md"), "utf8");
			const result = yield* harness.readResource("okf://index");
			assert.strictEqual(result.contents[0]?.text, expected);
			assert.strictEqual(result.contents[0]?.mimeType, "text/markdown");
		}).pipe(Effect.scoped),
	);

	it.effect("reads a nested concept id as that file's full text, frontmatter included", () =>
		Effect.gen(function* () {
			const { root, harness } = yield* open();
			const expected = readFileSync(join(root, "bundle", "metrics", "revenue.md"), "utf8");
			const result = yield* harness.readResource("okf://concept/metrics/revenue");
			assert.strictEqual(result.contents[0]?.text, expected);
			assert.ok(expected.startsWith("---\n"));
			assert.strictEqual(result.contents[0]?.mimeType, "text/markdown");
		}).pipe(Effect.scoped),
	);

	it.effect("fails a read of an unregistered concept uri at the protocol level", () =>
		Effect.gen(function* () {
			const { harness } = yield* open();
			const message = yield* harness.sendRequest("resources/read", { uri: "okf://concept/metrics/nope" });
			assert.ok(message.error !== undefined);
			assert.strictEqual(message.result, undefined);
		}).pipe(Effect.scoped),
	);

	it.effect("fails a read of okf://index when the bundle has no root index.md", () =>
		Effect.gen(function* () {
			const { root, harness } = yield* open();
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				yield* fs.remove(path.join(root, "bundle", "index.md"));
			}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
			const message = yield* harness.sendRequest("resources/read", { uri: "okf://index" });
			assert.ok(message.error !== undefined);
		}).pipe(Effect.scoped),
	);

	it.effect("boots with only okf://index listed when the bundle fails to load", () =>
		Effect.gen(function* () {
			const { harness } = yield* open("missing-bundle");
			const resources = yield* harness.listResources;
			assert.deepStrictEqual(
				resources.map((resource) => resource.uri),
				["okf://index"],
			);
		}).pipe(Effect.scoped),
	);
});
