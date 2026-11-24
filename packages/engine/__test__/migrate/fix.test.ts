import { assert, describe, it } from "@effect/vitest";
import type { LoadedBundle } from "@okfit/core";
import { Bundle, ConceptId, OkfitConfig } from "@okfit/core";
import { Derivation, Trust } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Option } from "effect";
import type { MigrationFixKind } from "../../src/migrate/findings.js";
import { migrationFindings } from "../../src/migrate/findings.js";
import type { MigrationFixOptions } from "../../src/migrate/fix.js";
import { applyMigrationFixes, planMigrationFixes } from "../../src/migrate/fix.js";
import { tally } from "../../src/render/exit.js";
import { collect } from "../../src/render/sort.js";
import { syncGenerated } from "../../src/sync/generated.js";
import { run } from "../../src/validate/run.js";
import type { ProjectSeed } from "../fixtures/bundles.js";
import { ERROR_PROJECTS, UNDECLARED_PROJECT, V02_PROJECT, V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, mountProject, sessionPlatform } from "../utils/bundle.js";

const CONFIG = OkfitConfig.DEFAULTS;
const NOW = DateTime.makeUnsafe("2026-11-24T00:00:00Z");
const COMPUTATION = "okf/computations/revenue-ytd.md";
const INDEX = "okf/index.md";
const ID = Option.getOrThrow(ConceptId.fromPath("computations/revenue-ytd.md"));

const on = (seed: ProjectSeed) => sessionPlatform(mountProject(seed));
const load = Bundle.load({ root: ROOT });
/** The file's exact text, a leading BOM included (memfs `readFileString` drops it). */
const read = (file: string) =>
	FileSystem.FileSystem.use((fs) => fs.readFile(`/repo/${file}`)).pipe(
		Effect.map((bytes) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)),
	);

const optionsFor = (
	bundle: LoadedBundle,
	extra: { readonly files?: ReadonlyArray<string>; readonly only?: ReadonlyArray<MigrationFixKind> } = {},
): MigrationFixOptions => ({ bundle, config: CONFIG, target: "0.3", now: NOW, ...extra });

const apply = (bundle: LoadedBundle, extra: Parameters<typeof optionsFor>[1] = {}) =>
	applyMigrationFixes({ ...optionsFor(bundle, extra), dryRun: false });

const counts = Effect.gen(function* () {
	const result = yield* run({
		root: ROOT,
		projectRoot: "/repo",
		config: CONFIG,
		profile: Option.none(),
		now: NOW,
		skipProvenance: true,
	});
	const t = tally(collect(result.report.conformance, result.report.lint, result.profileDiagnostics));
	return {
		errors: t.conformanceErrors + t.lintErrors + t.profileErrors,
		warnings: t.lintWarnings,
		brokenLinks: result.report.lint.filter((d) => d.code === "broken-links").length,
	};
});

describe("migration fixes", () => {
	it.effect("V02 -> 0.3 all at once: the computation becomes V03's text and validate is no worse", () =>
		Effect.gen(function* () {
			const before = yield* counts;
			const bundle = yield* load;
			assert.include(
				migrationFindings(bundle, CONFIG, "0.3").map((f) => f.code),
				"computation-locator",
			);
			const plan = yield* apply(bundle);
			assert.deepStrictEqual(plan.refused, []);
			assert.deepStrictEqual(
				plan.edits.map((e) => [e.path, e.fixes]),
				[
					["computations/revenue-ytd.md", ["root-relative-path", "root-relative-path"]],
					["index.md", ["okf-version"]],
				],
			);
			assert.strictEqual(yield* read(COMPUTATION), V03_PROJECT[COMPUTATION]);
			assert.include(yield* read(INDEX), "okf_version: '0.3'\n");
			assert.strictEqual(yield* read(INDEX), (V02_PROJECT[INDEX] as string).replace("'0.2'", "'0.3'"));
			const after = yield* counts;
			assert.isAtMost(after.errors, before.errors);
			assert.isAtMost(after.warnings, before.warnings);
			assert.strictEqual(after.brokenLinks, 0);
			assert.deepStrictEqual(migrationFindings(yield* load, CONFIG, "0.3"), []);
		}).pipe(Effect.provide(on(V02_PROJECT))),
	);

	it.effect("only: okf-version and files: [index.md] write nothing and refuse index.md with the R41 reason", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const reason =
				"2 reference(s) still resolve only from the bundle root; fix them first or run without --only/targets";
			for (const extra of [{ only: ["okf-version" as const] }, { files: ["index.md"] }]) {
				const plan = yield* apply(bundle, extra);
				assert.deepStrictEqual(plan.edits, []);
				assert.deepStrictEqual(
					plan.refused.map((r) => [r.file, r.code, r.reason]),
					[["index.md", "okf-version-older", reason]],
				);
				assert.strictEqual(yield* read(INDEX), V02_PROJECT[INDEX]);
				assert.strictEqual(yield* read(COMPUTATION), V02_PROJECT[COMPUTATION]);
			}
		}).pipe(Effect.provide(on(V02_PROJECT))),
	);

	it.effect("only: root-relative-path writes only the computation and leaves okf_version at 0.2 (control)", () =>
		Effect.gen(function* () {
			const plan = yield* apply(yield* load, { only: ["root-relative-path"] });
			assert.deepStrictEqual(
				plan.edits.map((e) => e.path),
				["computations/revenue-ytd.md"],
			);
			assert.deepStrictEqual(plan.refused, []);
			assert.strictEqual(yield* read(COMPUTATION), V03_PROJECT[COMPUTATION]);
			assert.strictEqual(yield* read(INDEX), V02_PROJECT[INDEX]);
		}).pipe(Effect.provide(on(V02_PROJECT))),
	);

	it.effect("an undeclared root index gains okf_version as the first line of a new block above the body", () =>
		Effect.gen(function* () {
			const plan = yield* apply(yield* load);
			assert.deepStrictEqual(plan.refused, []);
			assert.deepStrictEqual(plan.edits.find((e) => e.path === "index.md")?.fixes, ["okf-version"]);
			assert.strictEqual(yield* read(INDEX), `---\nokf_version: "0.3"\n---\n${UNDECLARED_PROJECT[INDEX] as string}`);
		}).pipe(Effect.provide(on(UNDECLARED_PROJECT))),
	);

	it.effect(
		"an undeclared root index that has frontmatter gets the line first and leaves the other keys byte-identical",
		() =>
			Effect.gen(function* () {
				yield* apply(yield* load);
				assert.strictEqual(
					yield* read(INDEX),
					'---\nokf_version: "0.3"\ntitle: "Acme  analytics"\nlicense: CC-BY-4.0\n---\n\n# Acme\n',
				);
			}).pipe(
				Effect.provide(
					on({ ...V03_PROJECT, [INDEX]: '---\ntitle: "Acme  analytics"\nlicense: CC-BY-4.0\n---\n\n# Acme\n' }),
				),
			),
	);

	it.effect("title before okf_version stays byte-identical, and a plain value is written double-quoted", () =>
		Effect.gen(function* () {
			yield* apply(yield* load);
			assert.strictEqual(yield* read(INDEX), '---\ntitle: "Acme  analytics"\nokf_version: "0.3"\n---\n\n# Acme\n');
		}).pipe(
			Effect.provide(
				on({ ...V03_PROJECT, [INDEX]: '---\ntitle: "Acme  analytics"\nokf_version: 0.2\n---\n\n# Acme\n' }),
			),
		),
	);

	it.effect("unparsable-version plans no edit for the version (control: the 0.2 bundle plans one)", () =>
		Effect.gen(function* () {
			const plan = yield* planMigrationFixes(optionsFor(yield* load));
			assert.deepStrictEqual(plan.edits, []);
			assert.deepStrictEqual(plan.refused, []);
		}).pipe(Effect.provide(on(ERROR_PROJECTS["unparsable-version"]))),
	);

	it.effect("dryRun returns the same plan and every file is byte-identical", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const dry = yield* applyMigrationFixes({ ...optionsFor(bundle), dryRun: true });
			assert.strictEqual(yield* read(INDEX), V02_PROJECT[INDEX]);
			assert.strictEqual(yield* read(COMPUTATION), V02_PROJECT[COMPUTATION]);
			assert.deepStrictEqual(dry, yield* planMigrationFixes(optionsFor(bundle)));
			assert.strictEqual(dry.edits.length, 2);
		}).pipe(Effect.provide(on(V02_PROJECT))),
	);

	for (const [name, wrap] of [
		["CRLF", (text: string) => text.replaceAll("\n", "\r\n")],
		["BOM", (text: string) => `﻿${text}`],
	] as const) {
		const original = wrap(V02_PROJECT[INDEX] as string);
		it.effect(`a ${name} root index changes only the value`, () =>
			Effect.gen(function* () {
				yield* apply(yield* load);
				assert.strictEqual(yield* read(INDEX), original.replace("'0.2'", "'0.3'"));
				assert.notStrictEqual(original, V02_PROJECT[INDEX]);
			}).pipe(Effect.provide(on({ ...V02_PROJECT, [INDEX]: original }))),
		);
	}

	describe("R44: trust after a fix", () => {
		const trusted = (text: string, body: string, content: string, recorded: boolean) =>
			text.replace(
				"runtime: sql\n",
				`runtime: sql\ngenerated:\n  by: okfit/test\n  at: 2026-02-01T00:00:00Z\nverified:\n  - by: human:a\n    at: 2026-03-01T00:00:00Z\n${
					recorded
						? `integrity:\n  generated:\n    body: ${body}\n  verified:\n    by: human:a\n    at: 2026-03-01T00:00:00Z\n    content: ${content}\n`
						: ""
				}`,
			);
		/** `V02_PROJECT` whose computation (`text`) is verified by a human and, when `recorded`, digest-bound. */
		const seedWith = (text: string, recorded: boolean) =>
			Effect.gen(function* () {
				const probe = { ...V02_PROJECT, [COMPUTATION]: trusted(text, "", "", false) };
				const bundle = yield* load.pipe(Effect.provide(on(probe)));
				const concept = bundle.concepts.get(ID);
				if (concept === undefined) return yield* Effect.die("probe concept missing");
				const body = yield* Derivation.bodyDigest(concept.document.source);
				const content = yield* Derivation.contentDigest(concept.frontmatter.raw, concept.document.source);
				return { ...V02_PROJECT, [COMPUTATION]: trusted(text, body, content, recorded) } as ProjectSeed;
			});
		const bodyLinkRooted = (V02_PROJECT[COMPUTATION] as string).replace(
			"](metrics/revenue.md)",
			"](/metrics/revenue.md)",
		);

		it.effect("re-records only integrity.generated.body: sync reports unchanged and the tier holds", () =>
			Effect.gen(function* () {
				const seed = yield* seedWith(V02_PROJECT[COMPUTATION] as string, true).pipe(Effect.provide(on(V02_PROJECT)));
				yield* Effect.gen(function* () {
					const bundle = yield* load;
					const before = yield* Trust.signal(bundle.concepts.get(ID) as never, CONFIG, NOW);
					assert.strictEqual(before.integrity, "current");
					assert.strictEqual(before.tier, "human-reviewed");
					const plan = yield* apply(bundle);
					assert.deepStrictEqual(plan.drifts, ["computations/revenue-ytd"]);
					const reloaded = yield* load;
					const synced = yield* syncGenerated(reloaded, { provenance: new Map(), dryRun: true, scope: new Set([ID]) });
					assert.deepStrictEqual(synced.unchanged, ["computations/revenue-ytd"]);
					assert.deepStrictEqual(synced.written, []);
					const after = yield* Trust.signal(reloaded.concepts.get(ID) as never, CONFIG, NOW);
					assert.strictEqual(after.tier, "human-reviewed");
					const text = yield* read(COMPUTATION);
					// generated.at, the verification and the binding are untouched
					assert.include(text, "generated:\n  by: okfit/test\n  at: 2026-02-01T00:00:00Z\n");
					assert.include(text, "verified:\n  - by: human:a\n    at: 2026-03-01T00:00:00Z\n");
					assert.include(text, "  verified:\n    by: human:a\n    at: 2026-03-01T00:00:00Z\n    content: ");
					const was = seed[COMPUTATION] as string;
					const oldBody = /body: ([0-9a-f]{16})/.exec(was)?.[1] as string;
					const newBody = /body: ([0-9a-f]{16})/.exec(text)?.[1] as string;
					assert.notStrictEqual(newBody, oldBody);
					assert.strictEqual(
						text.replace(newBody, oldBody).replaceAll("](/metrics", "](metrics").replace("resource: /", "resource: "),
						was,
					);
				}).pipe(Effect.provide(on(seed)));
			}),
		);

		it.effect("without a recorded digest no integrity is written (control)", () =>
			Effect.gen(function* () {
				const seed = yield* seedWith(V02_PROJECT[COMPUTATION] as string, false).pipe(Effect.provide(on(V02_PROJECT)));
				yield* Effect.gen(function* () {
					yield* apply(yield* load);
					const text = yield* read(COMPUTATION);
					assert.notInclude(text, "integrity:");
					assert.include(text, "](/metrics/revenue.md)");
				}).pipe(Effect.provide(on(seed)));
			}),
		);

		it.effect("a path-field-only change leaves the body digest alone and is listed in drifts", () =>
			Effect.gen(function* () {
				const seed = yield* seedWith(bodyLinkRooted, true).pipe(Effect.provide(on(V02_PROJECT)));
				yield* Effect.gen(function* () {
					const plan = yield* apply(yield* load);
					assert.deepStrictEqual(
						plan.edits.map((e) => [e.path, e.fixes]),
						[
							["computations/revenue-ytd.md", ["root-relative-path"]],
							["index.md", ["okf-version"]],
						],
					);
					assert.deepStrictEqual(plan.drifts, ["computations/revenue-ytd"]);
					assert.strictEqual(
						yield* read(COMPUTATION),
						(seed[COMPUTATION] as string).replace("resource: references/", "resource: /references/"),
					);
				}).pipe(Effect.provide(on(seed)));
			}),
		);
	});
});
