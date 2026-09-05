import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { AttestedComputation, ComputationParameter } from "../src/AttestedComputation.js";
import { ATTESTED_COMPUTATION_TYPE, Concept } from "../src/Concept.js";
import { Generated } from "../src/Generated.js";
import { Verification } from "../src/Verification.js";

const decodeFamily = Schema.decodeUnknownEffect(AttestedComputation);
const decodeConcept = Schema.decodeUnknownEffect(Concept);

describe("AttestedComputation", () => {
	it.effect("decodes the acme revenue-ytd.md shape", () =>
		Effect.gen(function* () {
			const family = yield* decodeFamily({
				runtime: "bigquery",
				parameters: [{ name: "year", type: "integer", required: true }],
				executor: { resource: "skills/run-on-bq.md", receipt: ["job_id", "executed_sql", "result"] },
				attester: { resource: "attesters/sql_equality.py" },
			});
			assert.strictEqual(family.runtime, "bigquery");
			assert.instanceOf(family.parameters[0], ComputationParameter);
			assert.isTrue(family.parameters[0]!.required);
			assert.deepStrictEqual(family.executor!.receipt, ["job_id", "executed_sql", "result"]);
			assert.strictEqual(family.attester!.resource, "attesters/sql_equality.py");
		}),
	);
	it.effect("defaults parameters to [] and required to false (D-20); rejects malformed members", () =>
		Effect.gen(function* () {
			const empty = yield* decodeFamily({});
			assert.deepStrictEqual(empty.parameters, []);
			assert.isFalse("runtime" in empty);
			assert.isFalse(
				(yield* decodeFamily({ parameters: [{ name: "period_end", type: "date" }] })).parameters[0]!.required,
			);
			for (const input of [
				{ executor: { resource: "skills/run-on-bq.md" } },
				{ parameters: [{ name: "year" }] },
				{ runtime: 7 },
			]) {
				assert.strictEqual((yield* Effect.flip(decodeFamily(input)))._tag, "SchemaError");
			}
		}),
	);
});

describe("Concept", () => {
	it.effect("decodes a full concept through the strict codec", () =>
		Effect.gen(function* () {
			assert.strictEqual(ATTESTED_COMPUTATION_TYPE, "Attested Computation");
			const concept = yield* decodeConcept({
				type: "BigQuery Table",
				title: "Orders",
				generated: { by: "reference_agent/gemini-2.5-pro", at: "2026-06-30T14:00:00Z" },
				verified: { by: "human:kliu@acme", at: "2026-07-01T16:00:00Z" },
				stale_after: "2026-12-31T00:00:00Z",
				extensions: { owner: "data-eng" },
				raw: { type: "BigQuery Table" },
			});
			assert.instanceOf(concept.generated, Generated);
			assert.instanceOf(concept.verified![0], Verification);
			assert.deepStrictEqual(concept.extensions, { owner: "data-eng" });
		}),
	);
	it.effect("requires a non-empty type plus extensions and raw, on decode and on make", () =>
		Effect.gen(function* () {
			for (const input of [{ type: "", extensions: {}, raw: {} }, { extensions: {}, raw: {} }, { type: "Module" }]) {
				assert.strictEqual((yield* Effect.flip(decodeConcept(input)))._tag, "SchemaError");
			}
			assert.strictEqual(Concept.make({ type: "Module", extensions: {}, raw: { type: "Module" } }).type, "Module");
			assert.throws(() => Concept.make({ type: "", extensions: {}, raw: {} }));
		}),
	);
});
