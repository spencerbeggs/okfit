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
	it("reports TypeMissing for absent, null, empty and non-string type and a null block; NotMapping for a scalar or list", () => {
		for (const value of [{ title: "x" }, { type: null }, { type: "" }, { type: 3 }, null]) {
			assert.strictEqual(decodeConcept(value)._tag, "TypeMissing");
		}
		for (const value of ["type: x", ["type"]]) {
			assert.strictEqual(decodeConcept(value)._tag, "NotMapping");
		}
		assert.strictEqual(decodeConcept({ type: "Note" })._tag, "Decoded");
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
	it("reads an out-of-vocabulary status as value-unknown and keeps it raw; a bad stale_after stays value-malformed", () => {
		const { concept, issues } = decoded({ type: "Note", status: "archived", stale_after: "90d" });
		assert.isFalse("status" in concept);
		assert.strictEqual(concept.raw.status, "archived");
		assert.deepStrictEqual(shape(issues), [
			["value-unknown", "status", ["status"]],
			["value-malformed", "stale_after", ["stale_after"]],
		]);
		const wrongType = decoded({ type: "Note", status: 5 });
		assert.deepStrictEqual(shape(wrongType.issues), [["value-unknown", "status", ["status"]]]);
		const control = decoded({ type: "Note", status: "draft" });
		assert.strictEqual(control.concept.status, "draft");
		assert.deepStrictEqual(control.issues, []);
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
	it("a wrong-typed family is absent with value-malformed", () => {
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

	it("computation-runtime-missing fires whenever the decoded runtime is absent, beside a readable control", () => {
		const codes = (runtime: unknown) =>
			decoded({ type: "Attested Computation", runtime }).issues.map((issue) => [issue.code, issue.path]);
		assert.deepStrictEqual(codes("bigquery"), []);
		assert.deepStrictEqual(codes(7), [
			["value-malformed", ["runtime"]],
			["computation-runtime-missing", []],
		]);
		assert.deepStrictEqual(codes(null), [["computation-runtime-missing", []]]);
		assert.deepStrictEqual(codes(""), [["computation-runtime-missing", []]]);
	});
	it("reads null and empty computation keys as absent with no issue (rule 1)", () => {
		for (const empty of [null, ""]) {
			const { concept, issues } = decoded({
				type: "Attested Computation",
				runtime: "bigquery",
				executor: empty,
				attester: empty,
				computation: empty,
				parameters: empty,
			});
			assert.deepStrictEqual(issues, []);
			assert.isFalse("executor" in concept.attested!);
			assert.isFalse("attester" in concept.attested!);
			assert.isFalse("computation" in concept.attested!);
			assert.deepStrictEqual(concept.attested?.parameters, []);
		}
		assert.deepStrictEqual(decoded({ type: "Attested Computation", runtime: "r", parameters: [] }).issues, []);
	});
	it("keeps the YAML index of a kept parameter after a dropped one", () => {
		const { concept, issues } = decoded({
			type: "Attested Computation",
			runtime: "bigquery",
			parameters: [{ name: "no type" }, { name: "year", type: "integer" }],
		});
		assert.deepStrictEqual(
			concept.attested?.parameters.map((p) => p.name),
			["year"],
		);
		assert.deepStrictEqual(concept.entries?.parameters, [["parameters", 1]]);
		assert.deepStrictEqual(shape(issues), [["entry-ignored", "attested", ["parameters", 0]]]);
	});
	it("a scalar receipt and a bad attester.resource each empty their mapping: both read as absent, runtime stays (R19)", () => {
		const { concept, issues } = decoded({
			type: "Attested Computation",
			runtime: "bigquery",
			executor: { receipt: "job_id" },
			attester: { resource: 5 },
		});
		assert.strictEqual(concept.attested?.runtime, "bigquery");
		assert.isUndefined(concept.attested?.executor);
		assert.isUndefined(concept.attested?.attester);
		assert.deepStrictEqual(shape(issues), [
			["value-malformed", "attested", ["executor", "receipt"]],
			["value-malformed", "attested", ["attester", "resource"]],
		]);
	});
	it("an executor with a resource and no receipt is valid", () => {
		const { concept, issues } = decoded({
			type: "Attested Computation",
			runtime: "bigquery",
			executor: { resource: "skills/run-on-bq.md" },
		});
		assert.strictEqual(concept.attested?.executor?.resource, "skills/run-on-bq.md");
		assert.deepStrictEqual(issues, []);
	});
	it("drops a later parameter entry alone and reports its YAML index", () => {
		const { concept, issues } = decoded({
			type: "Attested Computation",
			runtime: "bigquery",
			parameters: [{ name: "year", type: "integer" }, { name: "x" }],
		});
		assert.deepStrictEqual(
			concept.attested?.parameters.map((p) => p.name),
			["year"],
		);
		assert.deepStrictEqual(concept.entries?.parameters, [["parameters", 0]]);
		assert.deepStrictEqual(shape(issues), [["entry-ignored", "attested", ["parameters", 1]]]);
	});
	it("drops a malformed Source.usage_window alone and keeps the source", () => {
		const { concept, issues } = decoded({
			type: "Note",
			sources: [{ resource: "a.md", usage_window: { from: "2026-06-01T00:00:00Z", to: "soon" } }],
		});
		assert.strictEqual(concept.sources?.[0]?.resource, "a.md");
		assert.isFalse("usage_window" in concept.sources![0]!);
		assert.deepStrictEqual(shape(issues), [["value-malformed", "sources", ["sources", 0, "usage_window"]]]);
	});
	it("ignores a source with an empty resource and a non-mapping item", () => {
		const empty = decoded({ type: "Note", sources: [{ resource: "" }, { resource: "ok.md" }] });
		assert.deepStrictEqual(
			empty.concept.sources?.map((s) => s.resource),
			["ok.md"],
		);
		assert.deepStrictEqual(shape(empty.issues), [["entry-ignored", "sources", ["sources", 0]]]);
		const scalar = decoded({ type: "Note", sources: ["a.md"] });
		assert.isFalse("sources" in scalar.concept);
		assert.deepStrictEqual(shape(scalar.issues), [["entry-ignored", "sources", ["sources", 0]]]);
	});
	it("reads a null or empty legacy timestamp as absent with no issue (rule 1)", () => {
		for (const timestamp of [null, ""]) {
			const { concept, issues } = decoded({ type: "Metric", timestamp });
			assert.deepStrictEqual(issues, []);
			assert.isFalse("generated" in concept);
		}
		assert.strictEqual(decoded({ type: "Metric", timestamp: "2026-05-28T22:53:05Z" }).issues.length, 1);
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
	it("reads superseded_by as a string; null is absent with no issue, a non-string is value-malformed", () => {
		const control = decoded({ type: "Metric", superseded_by: "/metrics/gross-margin.md" });
		assert.strictEqual(control.concept.superseded_by, "/metrics/gross-margin.md");
		assert.deepStrictEqual(control.issues, []);
		const absent = decoded({ type: "Metric", superseded_by: null });
		assert.isFalse("superseded_by" in absent.concept);
		assert.deepStrictEqual(absent.issues, []);
		const malformed = decoded({ type: "Metric", superseded_by: 3 });
		assert.isFalse("superseded_by" in malformed.concept);
		assert.deepStrictEqual(shape(malformed.issues), [["value-malformed", "superseded_by", ["superseded_by"]]]);
	});
	it("a malformed parameters[].required is dropped at its own path and the parameter kept with required false (list and single form)", () => {
		for (const [parameters, path] of [
			[[{ name: "year", type: "integer", required: "yes" }], ["parameters", 0, "required"]],
			[{ name: "year", type: "integer", required: "x" }, ["parameters", "required"]],
		] as const) {
			const { concept, issues } = decoded({ type: "Attested Computation", runtime: "sql", parameters });
			assert.deepStrictEqual(shape(issues), [["value-malformed", "attested", path]]);
			assert.strictEqual(concept.attested?.parameters[0]?.name, "year");
			assert.strictEqual(concept.attested?.parameters[0]?.required, false);
		}
	});
	it("a null generated is absent (rule 1), so the legacy timestamp still applies; a real generated suppresses it", () => {
		const nullGenerated = decoded({ type: "T", generated: null, timestamp: "2026-01-01T00:00:00Z" });
		assert.strictEqual(nullGenerated.concept.generated?.by, Generated.LEGACY_BY);
		assert.deepStrictEqual(shape(nullGenerated.issues), [["legacy-timestamp", "timestamp", ["timestamp"]]]);
		const real = decoded({ type: "T", generated: { by: "human:a" }, timestamp: "2026-01-01T00:00:00Z" });
		assert.strictEqual(real.concept.generated?.by, "human:a");
		assert.deepStrictEqual(real.issues, []);
	});

	describe("a single mapping emptied by dropped keys reads as absent (OKF 0.3 11.2, ruling R19)", () => {
		const COMPUTATION = { type: "Attested Computation", runtime: "bigquery" };
		it("usage_window: every written key dropped is absent, the warning stays; {} and a surviving key are kept", () => {
			const dropped = decoded({ type: "Note", usage_window: { to: [1] } });
			assert.isFalse("usage_window" in dropped.concept);
			assert.deepStrictEqual(shape(dropped.issues), [["value-malformed", "usage_window", ["usage_window", "to"]]]);
			// controls: written `{}` is kept as written; one good key beside a dropped one is kept
			const empty = decoded({ type: "Note", usage_window: {} });
			assert.isTrue("usage_window" in empty.concept);
			assert.deepStrictEqual(empty.issues, []);
			const mixed = decoded({ type: "Note", usage_window: { from: "2026-06-01T00:00:00Z", to: [1] } });
			assert.isDefined(mixed.concept.usage_window?.from);
			assert.deepStrictEqual(shape(mixed.issues), [["value-malformed", "usage_window", ["usage_window", "to"]]]);
		});
		it("executor and attester: all-dropped is absent and keeps runtime; {} and a surviving key are kept", () => {
			const executor = decoded({ ...COMPUTATION, executor: { receipt: 5 } });
			assert.isUndefined(executor.concept.attested?.executor);
			assert.strictEqual(executor.concept.attested?.runtime, "bigquery");
			assert.deepStrictEqual(shape(executor.issues), [["value-malformed", "attested", ["executor", "receipt"]]]);
			const attester = decoded({ ...COMPUTATION, attester: { resource: 5 } });
			assert.isUndefined(attester.concept.attested?.attester);
			assert.deepStrictEqual(shape(attester.issues), [["value-malformed", "attested", ["attester", "resource"]]]);
			// controls
			const emptyExecutor = decoded({ ...COMPUTATION, executor: {}, attester: {} });
			assert.isDefined(emptyExecutor.concept.attested?.executor);
			assert.isDefined(emptyExecutor.concept.attested?.attester);
			assert.deepStrictEqual(emptyExecutor.issues, []);
			const mixed = decoded({ ...COMPUTATION, executor: { resource: "run.md", receipt: 5 } });
			assert.strictEqual(mixed.concept.attested?.executor?.resource, "run.md");
			assert.lengthOf(mixed.issues, 1);
		});
		it("generated needs `by`, so a mapping with every key dropped is ignored whole, not kept empty", () => {
			const { concept, issues } = decoded({ type: "Note", generated: { by: 5 } });
			assert.isFalse("generated" in concept);
			assert.deepStrictEqual(shape(issues), [["entry-ignored", "generated", ["generated"]]]);
			assert.isTrue("generated" in decoded({ type: "Note", generated: { by: "human:a", at: [1] } }).concept);
		});
		it("a source's own usage_window is dropped whole when any key is bad, and {} is kept", () => {
			const bad = decoded({ type: "Note", sources: [{ resource: "a.md", usage_window: { to: [1] } }] });
			assert.isFalse("usage_window" in bad.concept.sources![0]!);
			assert.deepStrictEqual(shape(bad.issues), [["value-malformed", "sources", ["sources", 0, "usage_window"]]]);
			const empty = decoded({ type: "Note", sources: [{ resource: "a.md", usage_window: {} }] });
			assert.isTrue("usage_window" in empty.concept.sources![0]!);
			assert.deepStrictEqual(empty.issues, []);
		});
	});
});
