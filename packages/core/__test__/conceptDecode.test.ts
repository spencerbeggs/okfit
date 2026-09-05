import { assert, describe, it } from "@effect/vitest";
import { DateTime } from "effect";
import { AttestedComputation } from "../src/AttestedComputation.js";
import { Generated } from "../src/Generated.js";
import { decodeConcept } from "../src/internal/conceptDecode.js";

const decoded = (value: unknown) => {
	const result = decodeConcept(value);
	return result._tag === "Decoded" ? result : assert.fail(`expected Decoded, got ${result._tag}`);
};
const shape = (issues: ReadonlyArray<{ code: string; family: string; path: ReadonlyArray<string | number> }>) =>
	issues.map((issue) => [issue.code, issue.family, issue.path]);

describe("decodeConcept", () => {
	it("decodes every family of an acme-style concept and preserves unknown keys", () => {
		const value = {
			type: "BigQuery Table",
			title: "Orders",
			sources: [{ resource: "policies/pii.md", author: "team:privacy", usage_count: "1240" }],
			usage_window: { from: "2026-04-01T00:00:00Z", to: "2026-06-30T00:00:00Z" },
			generated: { by: "reference_agent/gemini-2.5-pro", at: "2026-06-30T14:00:00Z" },
			verified: { by: "human:kliu@acme", at: "2026-07-01T16:00:00Z" },
			status: "stable",
			stale_after: "2026-12-31T00:00:00Z",
			owner: "data-eng",
			runtime: "bigquery",
		};
		const { concept, issues } = decoded(value);
		assert.deepStrictEqual(issues, []);
		assert.strictEqual(concept.sources![0]!.usage_count, 1240);
		assert.strictEqual(concept.verified!.length, 1);
		assert.strictEqual(DateTime.formatIso(concept.stale_after!), "2026-12-31T00:00:00.000Z");
		assert.isFalse("attested" in concept);
		assert.deepStrictEqual(concept.extensions, { owner: "data-eng", runtime: "bigquery" });
		assert.deepStrictEqual(concept.raw, value);
	});
	it("reports TypeMissing for absent, null, empty, non-string type and non-mapping input", () => {
		for (const value of [{ title: "x" }, { type: null }, { type: "" }, { type: 3 }, null, "type: x", ["type"]]) {
			assert.strictEqual(decodeConcept(value)._tag, "TypeMissing");
		}
	});
	it("omits a failing family, keeps it in raw, and reports family-invalid with the leaf path (D-15)", () => {
		const { concept, issues } = decoded({
			type: "Module",
			generated: { by: "reference_agent/gemini-2.5-pro", at: "2026-06-30T14:00:00" },
			status: "archived",
			title: "still fine",
		});
		assert.isFalse("generated" in concept);
		assert.isFalse("status" in concept);
		assert.strictEqual(concept.title, "still fine");
		assert.strictEqual(concept.raw.status, "archived");
		assert.deepStrictEqual(shape(issues), [
			["family-invalid", "generated", ["generated", "at"]],
			["family-invalid", "status", ["status"]],
		]);
		assert.include(issues[0]!.message, "explicit offset");
	});
	it("folds a legacy timestamp into generated.at, keeps the key in extensions, ignores it when generated exists", () => {
		const { concept, issues } = decoded({ type: "Metric", timestamp: "2026-05-28T22:53:05+00:00" });
		assert.instanceOf(concept.generated, Generated);
		assert.strictEqual(concept.generated!.by, Generated.LEGACY_BY);
		assert.strictEqual(DateTime.formatIso(concept.generated!.at!), "2026-05-28T22:53:05.000Z");
		assert.deepStrictEqual(concept.extensions, { timestamp: "2026-05-28T22:53:05+00:00" });
		assert.deepStrictEqual(shape(issues), [["legacy-timestamp", "timestamp", ["timestamp"]]]);
		const kept = decoded({ type: "Metric", generated: { by: "human:x" }, timestamp: "2026-05-28T22:53:05Z" });
		assert.deepStrictEqual(kept.issues, []);
		assert.isFalse("at" in kept.concept.generated!);
		const malformed = decoded({ type: "Metric", timestamp: "2026-05-28T22:53:05" });
		assert.isFalse("generated" in malformed.concept);
		assert.deepStrictEqual(shape(malformed.issues), [["family-invalid", "timestamp", ["timestamp"]]]);
	});
	it("decodes the computation family only for Attested Computation and flags a missing runtime (D-20)", () => {
		const { concept, issues } = decoded({
			type: "Attested Computation",
			parameters: [{ name: "year", type: "integer", required: true }],
			executor: { resource: "skills/run-on-bq.md", receipt: ["job_id"] },
			attester: { resource: "attesters/sql_equality.py" },
		});
		assert.instanceOf(concept.attested, AttestedComputation);
		assert.isTrue(concept.attested!.parameters[0]!.required);
		assert.deepStrictEqual(concept.extensions, {});
		assert.deepStrictEqual(issues, [
			{
				code: "computation-runtime-missing",
				family: "attested",
				path: [],
				message: "`runtime` is required on an Attested Computation",
			},
		]);
	});
	it("reports a failing computation family under the top-level key path and keeps the concept", () => {
		const { concept, issues } = decoded({
			type: "Attested Computation",
			runtime: "bigquery",
			executor: { resource: "skills/run-on-bq.md" },
		});
		assert.isFalse("attested" in concept);
		assert.deepStrictEqual(concept.extensions, {});
		assert.strictEqual(concept.raw.runtime, "bigquery");
		assert.deepStrictEqual(shape(issues), [["family-invalid", "attested", ["executor", "receipt"]]]);
	});
	it("stores a YAML __proto__ key as data, not as a prototype", () => {
		const { concept } = decoded(
			Object.fromEntries([
				["type", "Module"],
				["__proto__", { polluted: true }],
			]),
		);
		assert.deepStrictEqual(Object.keys(concept.extensions), ["__proto__"]);
		assert.isFalse("polluted" in {});
	});
});
