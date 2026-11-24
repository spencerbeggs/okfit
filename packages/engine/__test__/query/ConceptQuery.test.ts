import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { LoadedBundle } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import type { ConceptSignal } from "@okfit/profiles";
import { Cause, Effect, Exit, Layer, Path } from "effect";
import { ConceptQuery } from "../../src/query/ConceptQuery.js";
import { toConceptSummary } from "../../src/render/query.js";
import { ERROR_PROJECTS, V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, projectPlatform } from "../utils/bundle.js";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const config = {
	...OkfitConfig.DEFAULTS,
	types: { Decision: {}, Module: {} },
	tags: { architecture: {}, dx: {} },
};

const A = "---\ntype: Decision\nstatus: draft\ntags: [architecture]\n---\n\n# A\n";
const B =
	"---\ntype: Decision\ntags: [architecture, dx]\nverified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\n---\n\n# B\n\nSee [a](a.md).\n";
const M = "---\ntype: Module\n---\n\n# M\n\nSee [gone](gone.md).\n";

const withBundle = <A, E>(body: (bundle: LoadedBundle) => Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-engine-query-")));
		try {
			yield* Effect.promise(async () => {
				await mkdir(join(root, "decisions"));
				await writeFile(join(root, "decisions", "a.md"), A);
				await writeFile(join(root, "decisions", "b.md"), B);
				await writeFile(join(root, "m.md"), M);
			});
			const bundle = yield* Bundle.load({ root });
			return yield* body(bundle);
		} finally {
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}
	}).pipe(Effect.provide(platform));

// Hand-built signals: no hashing, no clock. a is stale, b is current, m is drifted.
const signals: ReadonlyMap<string, ConceptSignal> = new Map<string, ConceptSignal>([
	["decisions/a", { tier: "unverified", integrity: "none", stale: true, staleness: "stale" }],
	["decisions/b", { tier: "human-reviewed", integrity: "current", stale: false, staleness: "fresh" }],
	[
		"m",
		{
			tier: "machine-confirmed",
			integrity: "drifted",
			stale: false,
			staleness: "fresh",
			drift: { reason: "content-changed" },
		},
	],
]);

const ids = (concepts: ReadonlyArray<{ readonly id: string }>) => concepts.map((c) => c.id);

describe("ConceptQuery.list", () => {
	it.effect("returns every concept sorted by id for an empty filter", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				assert.deepStrictEqual(ids(yield* ConceptQuery.list(bundle, config, {}, signals)), [
					"decisions/a",
					"decisions/b",
					"m",
				]);
			}),
		),
	);

	it.effect("filters by type, tags (AND), status and the trust signal", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const run = (filter: Parameters<typeof ConceptQuery.list>[2]) =>
					ConceptQuery.list(bundle, config, filter, signals).pipe(Effect.map(ids));
				assert.deepStrictEqual(yield* run({ types: ["Decision"] }), ["decisions/a", "decisions/b"]);
				assert.deepStrictEqual(yield* run({ tags: ["architecture", "dx"] }), ["decisions/b"]);
				assert.deepStrictEqual(yield* run({ statuses: ["stable"] }), ["decisions/b", "m"]);
				assert.deepStrictEqual(yield* run({ verified: "current" }), ["decisions/b"]);
				assert.deepStrictEqual(yield* run({ verified: "unverified" }), ["decisions/a"]);
				assert.deepStrictEqual(yield* run({ drifted: true }), ["m"]);
				assert.deepStrictEqual(yield* run({ stale: true }), ["decisions/a"]);
				assert.deepStrictEqual(yield* run({ drifted: true, statuses: ["draft"] }), []);
				assert.deepStrictEqual(yield* run({ drifted: true, statuses: ["stable"] }), ["m"]);
			}),
		),
	);

	it.effect("dies when a signal-filtered query is missing a concept's signal", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(ConceptQuery.list(bundle, config, { drifted: true }, new Map()));
				assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
			}),
		),
	);

	it.effect("fails on an undeclared type with a sorted valid list", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const error = yield* ConceptQuery.list(bundle, config, { types: ["Nope"] }, signals).pipe(Effect.flip);
				assert.strictEqual(error._tag, "QueryUnknownVocabularyError");
				assert.strictEqual(error.kind, "type");
				assert.strictEqual(error.requested, "Nope");
				assert.deepStrictEqual(error.valid, ["Decision", "Module"]);
			}),
		),
	);

	it.effect("fails on an undeclared tag", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const error = yield* ConceptQuery.list(bundle, config, { tags: ["nope"] }, signals).pipe(Effect.flip);
				assert.strictEqual(error.kind, "tag");
				assert.deepStrictEqual(error.valid, ["architecture", "dx"]);
			}),
		),
	);
});

describe("ConceptQuery.list with an unknown status", () => {
	const seed = {
		[`${ROOT}/archived.md`]: "---\ntype: Decision\nstatus: archived\n---\n\n# Archived\n",
		[`${ROOT}/live.md`]: "---\ntype: Decision\nstatus: stable\n---\n\n# Live\n",
		[`${ROOT}/number.md`]: "---\ntype: Decision\nstatus: 5\n---\n\n# Number\n",
		[`${ROOT}/empty.md`]: '---\ntype: Decision\nstatus: ""\n---\n\n# Empty\n',
		[`${ROOT}/nulled.md`]: "---\ntype: Decision\nstatus: null\n---\n\n# Nulled\n",
		[`${ROOT}/draft.md`]: "---\ntype: Decision\nstatus: draft\n---\n\n# Draft\n",
	};
	const memPlatform = Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);
	const unknownSignals: ReadonlyMap<string, ConceptSignal> = new Map<string, ConceptSignal>([
		["archived", { tier: "unverified", integrity: "none", stale: false, staleness: "fresh" }],
		["live", { tier: "unverified", integrity: "none", stale: false, staleness: "fresh" }],
		["number", { tier: "unverified", integrity: "none", stale: false, staleness: "fresh" }],
		["empty", { tier: "unverified", integrity: "none", stale: false, staleness: "fresh" }],
		["nulled", { tier: "unverified", integrity: "none", stale: false, staleness: "fresh" }],
		["draft", { tier: "unverified", integrity: "none", stale: false, staleness: "fresh" }],
	]);

	it.effect("filters statuses: [stable] to the stable concept and summarizes the archived one as unknown", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			// an absent, null or "" status is stable (section 11.2 rule 1), never unknown
			assert.deepStrictEqual(ids(yield* ConceptQuery.list(bundle, config, { statuses: ["stable"] }, unknownSignals)), [
				"empty",
				"live",
				"nulled",
			]);
			assert.deepStrictEqual(ids(yield* ConceptQuery.list(bundle, config, { statuses: ["unknown"] }, unknownSignals)), [
				"archived",
				"number",
			]);
			const all = yield* ConceptQuery.list(bundle, config, {}, unknownSignals);
			assert.deepStrictEqual(ids(all), ["archived", "draft", "empty", "live", "nulled", "number"]);
			const pick = Object.fromEntries(
				all.map((concept) => {
					const summary = toConceptSummary(concept, unknownSignals.get(concept.id) as ConceptSignal);
					return [concept.id, { status: summary.status, raw_status: summary.raw_status }];
				}),
			);
			assert.deepStrictEqual(pick, {
				archived: { status: "unknown", raw_status: "archived" },
				draft: { status: "draft", raw_status: null },
				empty: { status: "stable", raw_status: null },
				live: { status: "stable", raw_status: null },
				nulled: { status: "stable", raw_status: null },
				number: { status: "unknown", raw_status: "5" },
			});
		}).pipe(Effect.provide(memPlatform)),
	);
});

describe("ConceptQuery.get", () => {
	it.effect("resolves a tolerant id and lists outgoing links", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const result = yield* ConceptQuery.get(bundle, "/decisions/b.md");
				assert.strictEqual(result.concept.id, "decisions/b");
				assert.deepStrictEqual(result.links, [{ to: "decisions/a", kind: "concept", source: "body" }]);
				const missing = yield* ConceptQuery.get(bundle, "m");
				assert.deepStrictEqual(
					missing.links.map((l) => l.kind),
					["missing"],
				);
			}),
		),
	);

	it.effect("fails with empty-id and not-a-concept", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const empty = yield* ConceptQuery.get(bundle, "").pipe(Effect.flip);
				assert.strictEqual(empty.reason, "empty-id");
				const nope = yield* ConceptQuery.get(bundle, "nope").pipe(Effect.flip);
				assert.strictEqual(nope.reason, "not-a-concept");
				assert.strictEqual(nope.id, "nope");
			}),
		),
	);
});

describe("ConceptQuery.neighbors", () => {
	it.effect("reports incoming concepts and null concepts for non-concept nodes", () =>
		withBundle((bundle) =>
			Effect.gen(function* () {
				const a = yield* ConceptQuery.neighbors(bundle, "decisions/a");
				assert.strictEqual(a.id, "decisions/a");
				assert.deepStrictEqual(ids(a.incoming), ["decisions/b"]);
				assert.strictEqual(a.incoming[0]?.concept?.id, "decisions/b");
				const m = yield* ConceptQuery.neighbors(bundle, "m");
				assert.strictEqual(m.outgoing.length, 1);
				assert.strictEqual(m.outgoing[0]?.concept, null);
				const error = yield* ConceptQuery.neighbors(bundle, "").pipe(Effect.flip);
				assert.strictEqual(error.reason, "empty-id");
			}),
		),
	);
});

const currentConfig = {
	...OkfitConfig.DEFAULTS,
	types: { Metric: {}, Module: {}, Project: {}, "Attested Computation": {} },
};
const ARCHIVED = "---\ntype: Metric\ntitle: Archived\ndescription: Old.\nstatus: archived\n---\n\n# Archived\n\nOld.\n";
const WITH_ARCHIVED = { ...V03_PROJECT, "okf/metrics/archived.md": ARCHIVED };
const onProject = <A, E>(seed: Readonly<Record<string, string>>, body: (bundle: LoadedBundle) => Effect.Effect<A, E>) =>
	Effect.flatMap(Bundle.load({ root: ROOT }), body).pipe(Effect.provide(projectPlatform(seed)));
const noSignals: ReadonlyMap<string, ConceptSignal> = new Map();

describe("ConceptQuery.list current (OKF 0.3 5.4)", () => {
	it.effect("drops deprecated and unknown concepts and lists the replacement once", () =>
		onProject(WITH_ARCHIVED, (bundle) =>
			Effect.gen(function* () {
				const all = ids(yield* ConceptQuery.list(bundle, currentConfig, {}, noSignals));
				// control: without `current`, the deprecated and the unknown-status concepts are listed
				assert.include(all, "metrics/margin-legacy");
				assert.include(all, "metrics/archived");
				const current = ids(yield* ConceptQuery.list(bundle, currentConfig, { current: true }, noSignals));
				assert.notInclude(current, "metrics/margin-legacy");
				assert.notInclude(current, "metrics/archived");
				assert.strictEqual(current.filter((id) => id === "metrics/margin").length, 1);
				assert.lengthOf(current, all.length - 2);
			}),
		),
	);

	it.effect("does not add a replacement that fails another filter", () =>
		onProject(WITH_ARCHIVED, (bundle) =>
			Effect.gen(function* () {
				// control: the Metric type filter keeps the Metric replacement
				const metrics = ids(
					yield* ConceptQuery.list(bundle, currentConfig, { current: true, types: ["Metric"] }, noSignals),
				);
				assert.deepStrictEqual(metrics, ["metrics/margin", "metrics/revenue"]);
				// the legacy Metric fails `types: ["Module"]`, so its replacement is not added either
				const modules = ids(
					yield* ConceptQuery.list(bundle, currentConfig, { current: true, types: ["Module"] }, noSignals),
				);
				assert.deepStrictEqual(modules, ["modules/widget"]);
			}),
		),
	);

	it.effect("lists a replacement reached through a deprecated chain once, in id order", () =>
		onProject(
			{
				...V03_PROJECT,
				"okf/metrics/margin-older.md":
					"---\ntype: Metric\ntitle: Older\ndescription: Older.\nstatus: deprecated\nsuperseded_by: ./margin-legacy.md\n---\n\n# Older\n\nOlder.\n",
			},
			(bundle) =>
				Effect.gen(function* () {
					const current = ids(yield* ConceptQuery.list(bundle, currentConfig, { current: true }, noSignals));
					// two deprecated concepts reach the same replacement through a chain; it appears once, in id order
					assert.deepStrictEqual(current, [...new Set(current)].toSorted());
					assert.strictEqual(current.filter((id) => id === "metrics/margin").length, 1);
					assert.notInclude(current, "metrics/margin-older");
					// `current` drops margin-older either way; the chain itself is what `get` reports
					assert.strictEqual((yield* ConceptQuery.get(bundle, "metrics/margin-older")).replacement, "metrics/margin");
				}),
		),
	);

	it.effect("an explicit statuses filter still constrains the result: current + deprecated lists nothing", () =>
		onProject(WITH_ARCHIVED, (bundle) =>
			Effect.gen(function* () {
				// control: the deprecated filter alone finds the legacy metric
				assert.deepStrictEqual(
					ids(yield* ConceptQuery.list(bundle, currentConfig, { statuses: ["deprecated"] }, noSignals)),
					["metrics/margin-legacy"],
				);
				assert.deepStrictEqual(
					yield* ConceptQuery.list(bundle, currentConfig, { current: true, statuses: ["deprecated"] }, noSignals),
					[],
				);
				// stable + current keeps stable concepts, and the replacement (stable) too
				const stable = ids(
					yield* ConceptQuery.list(bundle, currentConfig, { current: true, statuses: ["stable"] }, noSignals),
				);
				assert.include(stable, "metrics/margin");
				assert.notInclude(stable, "metrics/margin-legacy");
			}),
		),
	);

	it.effect("a replacement whose status is unknown is not added", () =>
		onProject(ERROR_PROJECTS["unknown-status"], (bundle) =>
			Effect.gen(function* () {
				const current = ids(yield* ConceptQuery.list(bundle, currentConfig, { current: true }, noSignals));
				// control: margin-legacy's replacement is margin (status: bogus), which is not current knowledge
				assert.notInclude(current, "metrics/margin");
				assert.notInclude(current, "metrics/margin-legacy");
				assert.include(current, "metrics/revenue");
			}),
		),
	);
});

describe("ConceptQuery.get replacement", () => {
	it.effect("reports the replacement of a deprecated concept, and null otherwise", () =>
		onProject(V03_PROJECT, (bundle) =>
			Effect.gen(function* () {
				assert.strictEqual((yield* ConceptQuery.get(bundle, "metrics/margin-legacy")).replacement, "metrics/margin");
				assert.strictEqual((yield* ConceptQuery.get(bundle, "metrics/margin")).replacement, null);
			}),
		),
	);

	it.effect("is null when the replacement is not current knowledge", () =>
		onProject(ERROR_PROJECTS["unknown-status"], (bundle) =>
			Effect.gen(function* () {
				assert.strictEqual((yield* ConceptQuery.get(bundle, "metrics/margin-legacy")).replacement, null);
			}),
		),
	);
});
