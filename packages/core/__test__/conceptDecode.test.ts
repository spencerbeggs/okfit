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
	it("keeps generated.by when at is malformed, drops only at, and reports value-malformed (D-15, Design 13)", () => {
		const { concept, issues } = decoded({
			type: "Module",
			generated: { by: "reference_agent/gemini-2.5-pro", at: "2026-06-30T14:00:00" },
			title: "still fine",
		});
		assert.strictEqual(concept.generated?.by, "reference_agent/gemini-2.5-pro");
		assert.isFalse("at" in concept.generated!);
		assert.strictEqual(concept.title, "still fine");
		assert.deepStrictEqual(shape(issues), [["value-malformed", "generated", ["generated", "at"]]]);
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
		assert.deepStrictEqual(shape(malformed.issues), [["value-malformed", "timestamp", ["timestamp"]]]);
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
	it("decodes each computation key alone: a bad executor.resource keeps runtime and the executor (rule 3)", () => {
		const { concept, issues } = decoded({
			type: "Attested Computation",
			runtime: "bigquery",
			executor: { resource: 5, receipt: ["job_id"] },
		});
		assert.strictEqual(concept.attested?.runtime, "bigquery");
		assert.deepStrictEqual(concept.attested?.executor?.receipt, ["job_id"]);
		assert.isFalse("resource" in concept.attested!.executor!);
		assert.deepStrictEqual(concept.extensions, {});
		assert.strictEqual(concept.raw.runtime, "bigquery");
		assert.deepStrictEqual(shape(issues), [["value-malformed", "attested", ["executor", "resource"]]]);
	});
	it("reads null, an empty string and an empty list as absent, with no issue (OKF 0.3 11.2 rule 1)", () => {
		const { concept, issues } = decoded({
			type: "Note",
			title: "",
			description: null,
			tags: [],
			stale_after: null,
			sources: null,
		});
		assert.deepStrictEqual(issues, []);
		for (const key of ["title", "description", "tags", "stale_after", "sources"]) assert.isFalse(key in concept, key);
		assert.strictEqual(concept.raw.title, "");
		assert.strictEqual(decoded({ type: "Note", title: "T" }).concept.title, "T");
	});
	it("reads one item as a list of one and never splits a scalar tag (rule 2)", () => {
		const { concept, issues } = decoded({
			type: "Attested Computation",
			runtime: "bigquery",
			tags: "finance, revenue",
			sources: { resource: "https://example.com/a" },
			parameters: { name: "year", type: "integer" },
		});
		assert.deepStrictEqual(issues, []);
		assert.deepStrictEqual(concept.tags, ["finance, revenue"]);
		assert.strictEqual(concept.sources?.[0]?.resource, "https://example.com/a");
		assert.deepStrictEqual(concept.entries?.sources, [["sources"]]);
		assert.strictEqual(concept.attested?.parameters[0]?.name, "year");
	});
	it("ignores an entry without a readable REQUIRED key and keeps each kept entry's YAML index (rule 3)", () => {
		const { concept, issues } = decoded({
			type: "Note",
			tags: ["x", 3, "z"],
			sources: [{ resource: "a.md" }, { title: "no resource" }, { resource: "c.md" }],
			verified: [
				{ by: "human:a", at: "2026-06-25T09:00:00Z" },
				{ by: "human:b" },
				{ by: "human:c", at: "2026-06-25T09:00:00" },
			],
			generated: { at: "2026-06-25T09:00:00Z" },
		});
		assert.deepStrictEqual(concept.tags, ["x", "z"]);
		assert.deepStrictEqual(concept.entries?.tags, [
			["tags", 0],
			["tags", 2],
		]);
		assert.deepStrictEqual(
			concept.sources?.map((s) => s.resource),
			["a.md", "c.md"],
		);
		assert.deepStrictEqual(concept.entries?.sources, [
			["sources", 0],
			["sources", 2],
		]);
		assert.deepStrictEqual(
			concept.verified?.map((v) => v.by),
			["human:a"],
		);
		assert.isFalse("generated" in concept);
		assert.deepStrictEqual(shape(issues), [
			["value-malformed", "tags", ["tags", 1]],
			["entry-ignored", "sources", ["sources", 1]],
			["entry-ignored", "generated", ["generated"]],
			["entry-ignored", "verified", ["verified", 1]],
			["entry-ignored", "verified", ["verified", 2]],
		]);
	});
	it("keeps an entry whose OPTIONAL key is malformed and drops only that key (rule 3)", () => {
		const { concept, issues } = decoded({
			type: "Note",
			sources: [{ resource: "a.md", id: "a", usage_count: "many", last_modified: "yesterday" }],
			generated: { by: "human:a", at: "2026-06-30T14:00:00" },
			usage_window: { from: "2026-06-01T00:00:00Z", to: "soon" },
		});
		assert.deepStrictEqual([concept.sources?.[0]?.resource, concept.sources?.[0]?.id], ["a.md", "a"]);
		assert.isFalse("usage_count" in concept.sources![0]!);
		assert.isFalse("last_modified" in concept.sources![0]!);
		assert.strictEqual(concept.generated?.by, "human:a");
		assert.isFalse("at" in concept.generated!);
		assert.isDefined(concept.usage_window?.from);
		assert.deepStrictEqual(shape(issues), [
			["value-malformed", "sources", ["sources", 0, "usage_count"]],
			["value-malformed", "sources", ["sources", 0, "last_modified"]],
			["value-malformed", "usage_window", ["usage_window", "to"]],
			["value-malformed", "generated", ["generated", "at"]],
		]);
	});
	it("a wrong-typed family is absent with value-malformed; a malformed integrity block is still family-invalid", () => {
		const { issues } = decoded({ type: "Note", title: 5, tags: { a: 1 }, sources: 5 });
		assert.deepStrictEqual(
			shape(issues).map(([code, , path]) => [code, path]),
			[
				["value-malformed", ["title"]],
				["value-malformed", ["tags"]],
				["entry-ignored", ["sources"]],
			],
		);
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

	it("a malformed integrity block is family-invalid for integrity only", () => {
		const result = decodeConcept({
			type: "Decision",
			generated: { by: "human:spencer", at: "2026-10-10T18:00:00Z" },
			verified: [{ by: "human:spencer", at: "2026-10-10T18:00:00Z" }],
			integrity: { verified: { by: "human:spencer", at: "nope", content: "xyz" } },
		});
		assert.strictEqual(result._tag, "Decoded");
		if (result._tag !== "Decoded") return;
		assert.isDefined(result.concept.generated);
		assert.isDefined(result.concept.verified);
		assert.isUndefined(result.concept.integrity);
		assert.isAbove(result.issues.length, 0);
		assert.isTrue(result.issues.every((issue) => issue.family === "integrity"));
		assert.isFalse("integrity" in result.concept.extensions);
	});

	it("a legacy 64-hex generated.body_sha256 still decodes generated", () => {
		const result = decodeConcept({
			type: "Decision",
			generated: { by: "human:spencer", at: "2026-10-10T18:00:00Z", body_sha256: "a".repeat(64) },
		});
		assert.strictEqual(result._tag, "Decoded");
		if (result._tag !== "Decoded") return;
		assert.strictEqual(result.concept.generated?.body_sha256, "a".repeat(64));
		assert.strictEqual(result.issues.length, 0);
	});
});
