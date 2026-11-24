import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { TestPlatform } from "../utils/platform.js";

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

/** The plan for a whole other bundle, so one test can hold a "nothing" assertion beside its positive control. */
const planIn = (seed: ProjectSeed) =>
	Effect.gen(function* () {
		return yield* planMigrationFixes(optionsFor(yield* load));
	}).pipe(Effect.provide(on(seed)));

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
			const control = yield* planIn(V02_PROJECT);
			assert.deepStrictEqual(
				control.edits.map((e) => e.path),
				["computations/revenue-ytd.md", "index.md"],
			);
		}).pipe(Effect.provide(on(ERROR_PROJECTS["unparsable-version"]))),
	);

	describe("a root index whose frontmatter does not parse (final-review finding 3)", () => {
		const duplicate = '---\nokf_version: "0.2"\nokf_version: "0.1"\n---\n\n# B\n';
		const malformed = '---\nokf_version: "0.2"\nbad: [\n---\n\n# B\n';
		const REASON = /^the root index frontmatter does not parse \(.+\); fix it by hand$/;
		// the root-relative fixes sit in the concept; the control is the same bundle with a valid root index
		const scenario = (name: string, index: string) =>
			it.effect(`${name}: the version fix is refused, nothing is written to the index, the rest still applies`, () =>
				Effect.gen(function* () {
					const first = yield* apply(yield* load);
					assert.strictEqual(yield* read(INDEX), index);
					assert.deepStrictEqual(
						first.edits.map((e) => e.path),
						["computations/revenue-ytd.md"],
					);
					assert.strictEqual(first.refused.length, 1);
					assert.strictEqual(first.refused[0]?.file, "index.md");
					assert.strictEqual(first.refused[0]?.code, "okf-version-undeclared");
					assert.match(first.refused[0]?.reason ?? "", REASON);
					assert.strictEqual(yield* read(COMPUTATION), V03_PROJECT[COMPUTATION]);
					// a second run gives the same refusal, still writing nothing to the index
					const second = yield* apply(yield* load);
					assert.deepStrictEqual(second.edits, []);
					assert.strictEqual(second.refused.length, 1);
					assert.match(second.refused[0]?.reason ?? "", REASON);
					assert.strictEqual(yield* read(INDEX), index);
					// control: the same bundle with a valid root index gets its version fixed
					const control = yield* planIn(V02_PROJECT);
					assert.deepStrictEqual(control.refused, []);
					assert.include(
						control.edits.map((e) => e.path),
						"index.md",
					);
				}).pipe(Effect.provide(on({ ...V02_PROJECT, [INDEX]: index }))),
			);
		scenario("a duplicate okf_version key", duplicate);
		scenario("malformed YAML", malformed);
	});

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

	describe("hardening", () => {
		const V03_WITH_INDEX = (index: string): ProjectSeed => ({ ...V03_PROJECT, [INDEX]: index });
		const unchangedFiles = (seed: ProjectSeed) =>
			Effect.gen(function* () {
				for (const [file, text] of Object.entries(seed)) assert.strictEqual(yield* read(file), text);
			});

		for (const [name, index, shape] of [
			["a flow-mapping frontmatter", '---\n{okf_version: "0.2", title: Acme}\n---\n\n# Acme\n', "flow-mapping"],
			["an empty okf_version", "---\nokf_version:\ntitle: Acme\n---\n\n# Acme\n", "okf_version-empty"],
			["an alias okf_version", '---\nx: &x "0.2"\nokf_version: *x\n---\n\n# Acme\n', "alias"],
		] as const) {
			it.effect(`${name} is refused in place and the file is untouched`, () =>
				Effect.gen(function* () {
					const seed = V03_WITH_INDEX(index);
					const plan = yield* apply(yield* load);
					assert.strictEqual(plan.refused.length, 1);
					assert.strictEqual(plan.refused[0]?.file, "index.md");
					assert.strictEqual(
						plan.refused[0]?.reason,
						`okf_version cannot be edited in place (${shape}); edit it by hand`,
					);
					assert.isFalse(plan.edits.some((e) => e.path === "index.md"));
					yield* unchangedFiles(seed);
				}).pipe(Effect.provide(on(V03_WITH_INDEX(index)))),
			);
		}

		it.effect(
			"an opening fence with trailing space is refused and the file is untouched (control: no fence at all gets a block)",
			() =>
				Effect.gen(function* () {
					const index = "--- \nokf_version: '0.2'\n---\n\n# Acme\n";
					const plan = yield* apply(yield* load);
					assert.deepStrictEqual(
						plan.refused.map((r) => [r.file, r.reason]),
						[["index.md", 'the opening fence is not exactly "---"; fix it by hand']],
					);
					assert.isFalse(plan.edits.some((e) => e.path === "index.md"));
					assert.strictEqual(yield* read(INDEX), index);
					const control = yield* planIn(UNDECLARED_PROJECT);
					assert.deepStrictEqual(control.refused, []);
					assert.strictEqual(
						control.edits.find((e) => e.path === "index.md")?.text,
						`---\nokf_version: "0.3"\n---\n${UNDECLARED_PROJECT[INDEX] as string}`,
					);
				}).pipe(Effect.provide(on(V03_WITH_INDEX("--- \nokf_version: '0.2'\n---\n\n# Acme\n")))),
		);

		it.effect("a bundle with no root index plans no version edit and creates no file (control: with one it does)", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const bundle = yield* load;
				for (const extra of [{}, { only: ["okf-version" as const] }]) {
					const plan = yield* apply(bundle, extra);
					assert.deepStrictEqual(plan.edits, []);
					assert.deepStrictEqual(plan.refused, []);
				}
				assert.isFalse(yield* fs.exists("/repo/okf/index.md"));
				const control = yield* planIn(V03_WITH_INDEX(V02_PROJECT[INDEX] as string));
				assert.deepStrictEqual(
					control.edits.map((e) => e.path),
					["index.md"],
				);
			}).pipe(Effect.provide(on(Object.fromEntries(Object.entries(V03_PROJECT).filter(([path]) => path !== INDEX))))),
		);

		it.effect("a concept with CRLF line endings changes only the inserted slash", () =>
			Effect.gen(function* () {
				const crlf = (V02_PROJECT[COMPUTATION] as string).replaceAll("\n", "\r\n");
				const plan = yield* apply(yield* load, { only: ["root-relative-path"] });
				assert.deepStrictEqual(plan.refused, []);
				const after = yield* read(COMPUTATION);
				assert.strictEqual(after.length, crlf.length + 2);
				assert.strictEqual(after.replace("(/metrics/", "(metrics/").replace("resource: /", "resource: "), crlf);
			}).pipe(
				Effect.provide(
					on({ ...V02_PROJECT, [COMPUTATION]: (V02_PROJECT[COMPUTATION] as string).replaceAll("\n", "\r\n") }),
				),
			),
		);

		it.effect("a concept with a leading BOM keeps it: the loader drops it, the write gives it back", () =>
			Effect.gen(function* () {
				const bundle = yield* load;
				assert.isTrue(bundle.concepts.has(ID));
				const plan = yield* apply(bundle, { only: ["root-relative-path"] });
				assert.deepStrictEqual(plan.refused, []);
				assert.strictEqual(yield* read(COMPUTATION), `\uFEFF${V03_PROJECT[COMPUTATION] as string}`);
			}).pipe(Effect.provide(on({ ...V02_PROJECT, [COMPUTATION]: `\uFEFF${V02_PROJECT[COMPUTATION] as string}` }))),
		);

		it.effect("an integrity layout the plan will not edit keeps the digest and lists the concept in drifts", () =>
			Effect.gen(function* () {
				const base = V02_PROJECT[COMPUTATION] as string;
				const probe = yield* load;
				const body = yield* Derivation.bodyDigest(
					(probe.concepts.get(ID) as NonNullable<unknown> as never as { document: { source: string } }).document.source,
				);
				const flow = `runtime: sql\ngenerated:\n  by: okfit/test\n  at: 2026-02-01T00:00:00Z\nintegrity: { generated: { body: ${body} } }\n`;
				const seed = { ...V02_PROJECT, [COMPUTATION]: base.replace("runtime: sql\n", flow) };
				yield* Effect.gen(function* () {
					const plan = yield* apply(yield* load);
					assert.deepStrictEqual(plan.drifts, ["computations/revenue-ytd"]);
					const text = yield* read(COMPUTATION);
					assert.include(text, `integrity: { generated: { body: ${body} } }\n`);
					assert.include(text, "](/metrics/revenue.md)");
					assert.strictEqual(
						text,
						(seed[COMPUTATION] as string)
							.replace("](metrics/", "](/metrics/")
							.replace("resource: references/", "resource: /references/"),
					);
				}).pipe(Effect.provide(on(seed)));
			}).pipe(Effect.provide(on(V02_PROJECT))),
		);
	});

	it.effect("on the real disk a BOM root index keeps its first three bytes and changes only the value", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-fix-")));
			yield* Effect.addFinalizer(() => Effect.promise(() => rm(dir, { recursive: true, force: true })));
			const original = `\uFEFF${V02_PROJECT[INDEX] as string}`;
			const seed: ProjectSeed = { ...V03_PROJECT, [INDEX]: original };
			for (const [file, text] of Object.entries(seed)) {
				yield* Effect.promise(async () => {
					await mkdir(dirname(join(dir, file)), { recursive: true });
					await writeFile(join(dir, file), text);
				});
			}
			const bundle = yield* Bundle.load({ root: join(dir, "okf") });
			const plan = yield* applyMigrationFixes({ ...optionsFor(bundle), dryRun: false });
			assert.deepStrictEqual(plan.refused, []);
			const bytes = yield* Effect.promise(() => readFile(join(dir, INDEX)));
			assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
			assert.strictEqual(bytes.toString("utf8"), original.replace("'0.2'", "'0.3'"));
		}).pipe(Effect.scoped, Effect.provide(TestPlatform)),
	);

	it.effect("on the real disk a BOM concept keeps exactly one BOM and changes only the inserted slash", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-fix-")));
			yield* Effect.addFinalizer(() => Effect.promise(() => rm(dir, { recursive: true, force: true })));
			const original = `\uFEFF${V02_PROJECT[COMPUTATION] as string}`;
			const seed: ProjectSeed = { ...V02_PROJECT, [COMPUTATION]: original };
			for (const [file, text] of Object.entries(seed)) {
				yield* Effect.promise(async () => {
					await mkdir(dirname(join(dir, file)), { recursive: true });
					await writeFile(join(dir, file), text);
				});
			}
			const bundle = yield* Bundle.load({ root: join(dir, "okf") });
			assert.isTrue(bundle.concepts.has(ID));
			const plan = yield* applyMigrationFixes({
				...optionsFor(bundle, { only: ["root-relative-path"] }),
				dryRun: false,
			});
			assert.deepStrictEqual(plan.refused, []);
			const bytes = yield* Effect.promise(() => readFile(join(dir, COMPUTATION)));
			assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
			assert.notDeepEqual([...bytes.subarray(3, 6)], [0xef, 0xbb, 0xbf]);
			assert.strictEqual(bytes.toString("utf8"), `\uFEFF${V03_PROJECT[COMPUTATION] as string}`);
		}).pipe(Effect.scoped, Effect.provide(TestPlatform)),
	);
});
