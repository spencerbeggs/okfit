import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Bundle } from "../src/Bundle.js";
import type { ConceptId } from "../src/ConceptId.js";
import { Diagnostic } from "../src/Diagnostic.js";
import { MOUNT, OKF_BUNDLES, okfBundlePlatform } from "./utils/bundles.js";

const EXPECTED = {
	acme_retail: { files: 18, concepts: 9, indexes: 7, logs: 1 },
	crypto_bitcoin: { files: 15, concepts: 9, indexes: 6, logs: 0 },
	ga4: { files: 14, concepts: 9, indexes: 5, logs: 0 },
	stackoverflow: { files: 32, concepts: 26, indexes: 6, logs: 0 },
} as const;

describe("Bundle.load over the vendored OKF bundles", () => {
	for (const name of OKF_BUNDLES) {
		it.effect(`${name} loads with the VENDORED.md counts and no conformance diagnostics`, () =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: MOUNT });
				assert.strictEqual(bundle.files.length, EXPECTED[name].files);
				assert.strictEqual(bundle.concepts.size, EXPECTED[name].concepts);
				assert.strictEqual(bundle.indexes.size, EXPECTED[name].indexes);
				assert.strictEqual(bundle.logs.size, EXPECTED[name].logs);
				assert.deepStrictEqual(bundle.diagnostics.filter(Diagnostic.isConformance), []);
				assert.isTrue(bundle.indexes.has(""));
				for (const dir of bundle.directories) assert.isTrue(bundle.indexes.has(dir), `index for ${dir}`);
				for (const [id, concept] of bundle.concepts) assert.strictEqual(concept.path, `${id}.md`);
			}).pipe(Effect.provide(okfBundlePlatform(name))),
		);
	}
	it.effect("acme_retail: log groups, attester file, computation body, log-frontmatter warning", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.deepStrictEqual(
				bundle.diagnostics.map((d) => [d.file, d.code]),
				[["log.md", "log-frontmatter"]],
			);
			assert.strictEqual(bundle.logs.get("")?.title, "Bundle history");
			assert.deepStrictEqual(
				bundle.logs.get("")?.groups.map((g) => g.date),
				["2026-07-01", "2026-06-30", "2026-04-15", "2026-02-10"],
			);
			assert.isTrue(bundle.files.includes("attesters/sql_equality.py"));
			const computation = bundle.concepts.get("computations/revenue-ytd" as ConceptId);
			assert.strictEqual(computation?.frontmatter.type, "Attested Computation");
			assert.isTrue(Option.isSome(computation?.computationBody ?? Option.none()));
		}).pipe(Effect.provide(okfBundlePlatform("acme_retail"))),
	);
});
