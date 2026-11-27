import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Bundle } from "../src/Bundle.js";
import type { ConceptId } from "../src/ConceptId.js";
import { MOUNT, platform } from "./utils/fixtures.js";

const load = (frontmatter: string) =>
	Bundle.load({ root: MOUNT }).pipe(
		Effect.provide(platform({ [`${MOUNT}/c.md`]: `---\n${frontmatter}\n---\n\n# C\n` })),
	);

const concept = (bundle: Effect.Success<ReturnType<typeof load>>) => bundle.concepts.get("c" as ConceptId)?.frontmatter;

const WRONG = ["5", "true", "null", "{ a: 1 }", "[1]", "yes", "2026-01-01x"];

// One row per mapping class: the YAML head up to the key under test, the keys, and the base text for the mapping.
interface Row {
	readonly cls: string;
	readonly build: (key: string, value: string) => string;
	readonly keys: ReadonlyArray<string>;
}
const ROWS: ReadonlyArray<Row> = [
	{
		cls: "Source",
		build: (key, value) => `type: T\nsources:\n  - resource: a.md\n    ${key}: ${value}`,
		keys: ["id", "title", "author", "usage_count", "last_modified", "usage_window"],
	},
	{
		cls: "Verification",
		build: (key, value) => `type: T\nverified:\n  - by: human:a\n    at: 2026-01-01T00:00:00Z\n    ${key}: ${value}`,
		keys: [],
	},
	{
		cls: "ComputationParameter",
		build: (key, value) =>
			`type: Attested Computation\nruntime: sql\nparameters:\n  - name: year\n    type: integer\n    ${key}: ${value}`,
		keys: ["required"],
	},
	{
		cls: "ComputationParameter (single mapping)",
		build: (key, value) =>
			`type: Attested Computation\nruntime: sql\nparameters:\n  name: year\n  type: integer\n  ${key}: ${value}`,
		keys: ["required"],
	},
	{
		cls: "Generated",
		build: (key, value) => `type: T\ngenerated:\n  by: process:x\n  ${key}: ${value}`,
		keys: ["at", "body_sha256"],
	},
	{
		cls: "UsageWindow",
		build: (key, value) => `type: T\nusage_window:\n  ${key}: ${value}`,
		keys: ["from", "to"],
	},
	{
		cls: "ComputationExecutor",
		build: (key, value) => `type: Attested Computation\nruntime: sql\nexecutor:\n  ${key}: ${value}`,
		keys: ["resource", "receipt"],
	},
	{
		cls: "ComputationAttester",
		build: (key, value) => `type: Attested Computation\nruntime: sql\nattester:\n  ${key}: ${value}`,
		keys: ["resource"],
	},
];

describe("Bundle.load on hostile optional keys", () => {
	it.effect(
		"a malformed parameters[].required is dropped with one warning and the parameter is kept (list and single form)",
		() =>
			Effect.gen(function* () {
				const list = yield* load(
					"type: Attested Computation\nruntime: sql\nparameters:\n  - name: year\n    type: integer\n    required: yes",
				);
				const warnings = list.diagnostics.filter((d) => d.code === "value-malformed");
				assert.strictEqual(warnings.length, 1);
				assert.strictEqual(warnings[0]?.severity, "warning");
				const parameter = list.concepts.get("c" as ConceptId)?.frontmatter.attested?.parameters[0];
				assert.strictEqual(parameter?.name, "year");
				assert.strictEqual(parameter?.required, false);

				const single = yield* load(
					"type: Attested Computation\nruntime: sql\nparameters:\n  name: year\n  type: integer\n  required: x",
				);
				assert.strictEqual(single.diagnostics.filter((d) => d.code === "value-malformed").length, 1);
				assert.strictEqual(single.concepts.get("c" as ConceptId)?.frontmatter.attested?.parameters[0]?.required, false);

				// control: a real boolean is kept and nothing is reported
				const good = yield* load(
					"type: Attested Computation\nruntime: sql\nparameters:\n  - name: year\n    type: integer\n    required: true",
				);
				assert.strictEqual(good.diagnostics.length, 0);
				assert.strictEqual(good.concepts.get("c" as ConceptId)?.frontmatter.attested?.parameters[0]?.required, true);
			}),
	);

	it.effect("every class survives every wrong-typed optional key: the load succeeds and reports only warnings", () =>
		Effect.gen(function* () {
			let reported = 0;
			for (const row of ROWS) {
				for (const key of row.keys) {
					for (const value of WRONG) {
						const bundle = yield* load(row.build(key, value));
						assert.isTrue(bundle.concepts.has("c" as ConceptId), `${row.cls}.${key}: ${value}`);
						assert.isTrue(
							bundle.diagnostics.every((d) => d.severity === "warning"),
							`${row.cls}.${key}: ${value}`,
						);
						reported += bundle.diagnostics.length;
					}
				}
			}
			// positive control: the table does provoke warnings
			assert.isAbove(reported, 0);
		}),
	);

	it.effect(
		"a mapping emptied by dropped keys reads as absent, never as {}; {} and a surviving key are kept (R19)",
		() =>
			Effect.gen(function* () {
				const rows: ReadonlyArray<{
					readonly cls: string;
					readonly head: string;
					readonly read: (frontmatter: NonNullable<ReturnType<typeof concept>>) => unknown;
				}> = [
					{ cls: "UsageWindow", head: "type: T\nusage_window", read: (f) => f.usage_window },
					{
						cls: "ComputationExecutor",
						head: "type: Attested Computation\nruntime: sql\nexecutor",
						read: (f) => f.attested?.executor,
					},
					{
						cls: "ComputationAttester",
						head: "type: Attested Computation\nruntime: sql\nattester",
						read: (f) => f.attested?.attester,
					},
					{
						cls: "Source.usage_window",
						head: "type: T\nsources:\n  - resource: a.md\n    usage_window",
						read: (f) => f.sources?.[0]?.usage_window,
					},
				];
				const bad: Record<string, string> = {
					UsageWindow: "to: [1]",
					ComputationExecutor: "receipt: 5",
					ComputationAttester: "resource: 5",
					"Source.usage_window": "to: [1]",
				};
				for (const row of rows) {
					const indent = row.cls === "Source.usage_window" ? "      " : "  ";
					const loaded = yield* load(`${row.head}:\n${indent}${bad[row.cls]}`);
					const found = concept(loaded);
					assert.isDefined(found, row.cls);
					assert.isUndefined(row.read(found!), `${row.cls}: all-dropped reads as absent`);
					assert.strictEqual(loaded.diagnostics.filter((d) => d.code === "value-malformed").length, 1, row.cls);
					// control: written `{}` is kept as written, with no warning
					const empty = yield* load(`${row.head}: {}`);
					assert.isDefined(row.read(concept(empty)!), `${row.cls}: {} is kept`);
					assert.strictEqual(empty.diagnostics.length, 0, row.cls);
				}
				// control: one good key beside a dropped one is kept (the key families that decode per key)
				const mixed = yield* load("type: T\nusage_window:\n  from: 2026-06-01T00:00:00Z\n  to: [1]");
				assert.isDefined(concept(mixed)?.usage_window?.from);
				const executor = yield* load(
					"type: Attested Computation\nruntime: sql\nexecutor:\n  resource: run.md\n  receipt: 5",
				);
				assert.strictEqual(concept(executor)?.attested?.executor?.resource, "run.md");
			}),
	);
	it.effect("a good key beside a bad one survives in every mapping family, at every depth (#461)", () =>
		Effect.gen(function* () {
			type F = NonNullable<ReturnType<typeof concept>>;
			const rows: ReadonlyArray<{
				readonly cls: string;
				readonly text: (to: string) => string;
				readonly good: (f: F) => unknown;
				readonly bad: (f: F) => unknown;
				readonly badLine: number;
			}> = [
				{
					cls: "UsageWindow",
					text: (to) => `type: T\nusage_window:\n  from: 2026-06-01T00:00:00Z\n  to: ${to}`,
					good: (f) => f.usage_window?.from,
					bad: (f) => f.usage_window?.to,
					badLine: 4,
				},
				{
					cls: "Source.usage_window",
					text: (to) =>
						`type: T\nsources:\n  - resource: a.md\n    usage_window:\n      from: 2026-06-01T00:00:00Z\n      to: ${to}`,
					good: (f) => f.sources?.[0]?.usage_window?.from,
					bad: (f) => f.sources?.[0]?.usage_window?.to,
					badLine: 6,
				},
				{
					cls: "ComputationExecutor",
					text: (r) => `type: Attested Computation\nruntime: sql\nexecutor:\n  resource: run.md\n  receipt: ${r}`,
					good: (f) => f.attested?.executor?.resource,
					bad: (f) => f.attested?.executor?.receipt,
					badLine: 5,
				},
				{
					cls: "Generated",
					text: (at) => `type: T\ngenerated:\n  by: process:x\n  at: ${at}`,
					good: (f) => f.generated?.by,
					bad: (f) => f.generated?.at,
					badLine: 4,
				},
			];
			const goodValue: Record<string, string> = {
				UsageWindow: "2026-07-01T00:00:00Z",
				"Source.usage_window": "2026-07-01T00:00:00Z",
				ComputationExecutor: "[ok]",
				Generated: "2026-07-01T00:00:00Z",
			};
			const badValue: Record<string, string> = {
				UsageWindow: "[1]",
				"Source.usage_window": "[1]",
				ComputationExecutor: "[1]",
				Generated: "[1]",
			};
			for (const row of rows) {
				const loaded = yield* load(row.text(badValue[row.cls]!));
				const found = concept(loaded);
				assert.isDefined(found, row.cls);
				assert.isDefined(row.good(found!), `${row.cls}: the good key is kept`);
				assert.isUndefined(row.bad(found!), `${row.cls}: the bad key is dropped`);
				const malformed = loaded.diagnostics.filter((d) => d.code === "value-malformed");
				assert.strictEqual(malformed.length, 1, row.cls);
				assert.strictEqual(malformed[0]!.range?.line, row.badLine, `${row.cls}: at the bad key's line`);
				// control: both keys good keeps both with no diagnostic
				const clean = yield* load(row.text(goodValue[row.cls]!));
				assert.isDefined(row.good(concept(clean)!), `${row.cls}: control good`);
				assert.isDefined(row.bad(concept(clean)!), `${row.cls}: control both kept`);
				assert.strictEqual(clean.diagnostics.length, 0, `${row.cls}: control has no diagnostic`);
			}
		}),
	);

	it.effect("an unknown key does not keep a mapping whose known keys were all dropped (#461 ruling)", () =>
		Effect.gen(function* () {
			const rows: ReadonlyArray<{
				readonly cls: string;
				readonly head: string;
				readonly indent: string;
				readonly bad: string;
				readonly good: string;
				readonly read: (f: NonNullable<ReturnType<typeof concept>>) => unknown;
				readonly rawOf: (raw: Record<string, unknown>) => unknown;
			}> = [
				{
					cls: "UsageWindow",
					head: "type: T\nusage_window",
					indent: "  ",
					bad: "to: [1]",
					good: "from: 2026-06-01T00:00:00Z",
					read: (f) => f.usage_window,
					rawOf: (raw) => raw.usage_window,
				},
				{
					cls: "ComputationExecutor",
					head: "type: Attested Computation\nruntime: sql\nexecutor",
					indent: "  ",
					bad: "receipt: 5",
					good: "resource: run.md",
					read: (f) => f.attested?.executor,
					rawOf: (raw) => raw.executor,
				},
				{
					cls: "ComputationAttester",
					head: "type: Attested Computation\nruntime: sql\nattester",
					indent: "  ",
					bad: "resource: 5",
					good: "resource: r.md",
					read: (f) => f.attested?.attester,
					rawOf: (raw) => raw.attester,
				},
				{
					cls: "Source.usage_window",
					head: "type: T\nsources:\n  - resource: a.md\n    usage_window",
					indent: "      ",
					bad: "to: [1]",
					good: "from: 2026-06-01T00:00:00Z",
					read: (f) => f.sources?.[0]?.usage_window,
					rawOf: (raw) => (raw.sources as ReadonlyArray<Record<string, unknown>>)[0]?.usage_window,
				},
			];
			for (const row of rows) {
				const block = (...lines: ReadonlyArray<string>) =>
					`${row.head}:\n${lines.map((l) => `${row.indent}${l}`).join("\n")}`;
				const mixed = yield* load(block(row.bad, "x: 1"));
				assert.isUndefined(row.read(concept(mixed)!), `${row.cls}: all known keys dropped reads as absent`);
				assert.strictEqual(mixed.diagnostics.filter((d) => d.code === "value-malformed").length, 1, row.cls);
				const raw = mixed.concepts.get("c" as ConceptId)!.frontmatter.raw as Record<string, unknown>;
				assert.deepStrictEqual((row.rawOf(raw) as Record<string, unknown>).x, 1, `${row.cls}: raw keeps x`);
				// control: an unknown key alone drops nothing, so the mapping is kept
				const only = yield* load(block("x: 1"));
				assert.isDefined(row.read(concept(only)!), `${row.cls}: { x: 1 } is kept`);
				assert.strictEqual(only.diagnostics.length, 0, row.cls);
				// control: a good known key beside an unknown key is kept
				const goodUnknown = yield* load(block(row.good, "x: 1"));
				assert.isDefined(row.read(concept(goodUnknown)!), `${row.cls}: good + unknown is kept`);
			}
		}),
	);
});
