import { assert, describe, it } from "@effect/vitest";
import type { LoadedBundle } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { DateTime, Effect, Option } from "effect";
import type { MigrationFinding } from "../../src/migrate/findings.js";
import { migrationFindings } from "../../src/migrate/findings.js";
import { collect, sort } from "../../src/render/sort.js";
import { run } from "../../src/validate/run.js";
import type { ProjectSeed } from "../fixtures/bundles.js";
import { ERROR_PROJECTS, UNDECLARED_PROJECT, V02_PROJECT, V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, mountProject, projectPlatform, sessionPlatform, sourceOf } from "../utils/bundle.js";

const CONFIG = OkfitConfig.DEFAULTS;
const COMPUTATION = "okf/computations/revenue-ytd.md";
const FILE = "computations/revenue-ytd.md";

const summarize = (findings: ReadonlyArray<MigrationFinding>) =>
	findings.map((f) => [f.file, f.code, f.fix ?? null, f.range?.line ?? null]);

const findingsOf = (seed: ProjectSeed, target = "0.3") =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: ROOT });
		return { bundle, found: migrationFindings(bundle, CONFIG, target) };
	}).pipe(Effect.provide(projectPlatform(seed)));

const rootRelative = (findings: ReadonlyArray<MigrationFinding>) =>
	findings.filter((f) => f.code === "root-relative-path");

/** The text a finding's range covers in the file it names. */
const covered = (bundle: LoadedBundle, finding: MigrationFinding): string | undefined => {
	const source = sourceOf(bundle, finding.file);
	return source === undefined || finding.range === undefined
		? undefined
		: source.slice(finding.range.offset, finding.range.offset + finding.range.length);
};

/** `V02_PROJECT` whose computation is the V0.3 spelling (both references rooted), with one edit applied. */
const rootedWith = (edit: (text: string) => string): ProjectSeed => ({
	...V02_PROJECT,
	[COMPUTATION]: edit(V03_PROJECT[COMPUTATION] as string),
});

describe("migrationFindings", () => {
	it.effect("V02 -> 0.3: the version, both root-only references and the computation, nothing else", () =>
		Effect.gen(function* () {
			const { found } = yield* findingsOf(V02_PROJECT);
			// Lines are zero-based over the seed text: 7 attester.resource, 12 the body link, 14 the `## Computation`
			// heading, 1 the `okf_version` line; they match the brief's numbers.
			assert.deepStrictEqual(summarize(found), [
				[FILE, "root-relative-path", "root-relative-path", 7],
				[FILE, "root-relative-path", "root-relative-path", 12],
				[FILE, "computation-locator", null, 14],
				["index.md", "okf-version-older", "okf-version", 1],
			]);
		}),
	);

	it.effect("states each message verbatim", () =>
		Effect.gen(function* () {
			const { found } = yield* findingsOf(V02_PROJECT);
			assert.deepStrictEqual(
				found.map((f) => f.message),
				[
					'attester.resource "references/attesters/check.py" resolves only from the bundle root, which OKF 0.3 does not do (§6.2); write it as "/references/attesters/check.py"',
					'link "metrics/revenue.md" resolves only from the bundle root, which OKF 0.3 does not do (§6.2); write it as "/metrics/revenue.md"',
					"The Computation section reads differently under OKF 0.3 (§10.3): the first fenced block at any heading level",
					'okf_version "0.2" is older than 0.3',
				],
			);
		}),
	);

	it.effect("V03_PROJECT yields nothing (control: V02_PROJECT yields findings)", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* findingsOf(V03_PROJECT)).found, []);
			assert.isAbove((yield* findingsOf(V02_PROJECT)).found.length, 0);
		}),
	);

	it.effect("an undeclared bundle yields okf-version-undeclared, fixable, instead of -older", () =>
		Effect.gen(function* () {
			const { found } = yield* findingsOf(UNDECLARED_PROJECT);
			const version = found.filter((f) => f.code.startsWith("okf-version"));
			assert.deepStrictEqual(summarize(version), [["index.md", "okf-version-undeclared", "okf-version", null]]);
			assert.strictEqual(
				version[0]?.message,
				"okf_version is not declared; OKF 0.3 §8.1 asks a bundle to declare it, and okfit reads an undeclared bundle with the v0.2 fallbacks",
			);
		}),
	);

	it.effect("a bundle with no root index yields okf-version-undeclared with no fix (R42)", () =>
		Effect.gen(function* () {
			const { "okf/index.md": _index, ...noIndex } = V02_PROJECT;
			const { found } = yield* findingsOf(noIndex);
			const version = found.filter((f) => f.code.startsWith("okf-version"));
			assert.deepStrictEqual(summarize(version), [["index.md", "okf-version-undeclared", null, null]]);
			// control: the root index is what makes the declaration fixable
			assert.strictEqual(
				(yield* findingsOf(UNDECLARED_PROJECT)).found.find((f) => f.code.startsWith("okf-version"))?.fix,
				"okf-version",
			);
		}),
	);

	it.effect("bare-path-under-0.3 yields the two root-relative-path findings and no version finding", () =>
		Effect.gen(function* () {
			const { bundle, found } = yield* findingsOf(ERROR_PROJECTS["bare-path-under-0.3"]);
			assert.deepStrictEqual(summarize(found), [
				[FILE, "root-relative-path", "root-relative-path", 7],
				[FILE, "root-relative-path", "root-relative-path", 12],
			]);
			assert.deepStrictEqual(
				found.map((f) => covered(bundle, f)),
				["references/attesters/check.py", "metrics/revenue.md"],
			);
		}),
	);

	it.effect("unparsable-version yields okf-version-unparsable with no fix", () =>
		Effect.gen(function* () {
			const { found } = yield* findingsOf(ERROR_PROJECTS["unparsable-version"]);
			assert.deepStrictEqual(summarize(found), [["index.md", "okf-version-unparsable", null, 1]]);
			assert.strictEqual(found[0]?.message, 'okf_version "v0.3" is not a <major>.<minor> version; fix it by hand');
		}),
	);

	it.effect("a bare link to a file that exists under neither rule yields nothing (control: a root-only one does)", () =>
		Effect.gen(function* () {
			const nowhere = yield* findingsOf(
				rootedWith((text) => text.replace("(/metrics/revenue.md)", "(metrics/nowhere.md)")),
			);
			assert.deepStrictEqual(rootRelative(nowhere.found), []);
			const rootOnly = yield* findingsOf(
				rootedWith((text) => text.replace("(/metrics/revenue.md)", "(metrics/revenue.md)")),
			);
			assert.deepStrictEqual(summarize(rootOnly.found.filter((f) => f.code === "root-relative-path")), [
				[FILE, "root-relative-path", "root-relative-path", 12],
			]);
		}),
	);

	describe("the range covers only the value (Review Focus 3)", () => {
		const cases: ReadonlyArray<readonly [string, (text: string) => string, string]> = [
			[
				"a fragment",
				(t) => t.replace("(/metrics/revenue.md)", "(metrics/revenue.md#total)"),
				"metrics/revenue.md#total",
			],
			["a dropped .md", (t) => t.replace("(/metrics/revenue.md)", "(metrics/revenue)"), "metrics/revenue"],
			["angle brackets", (t) => t.replace("(/metrics/revenue.md)", "(<metrics/revenue.md>)"), "metrics/revenue.md"],
			[
				"a single-quoted field",
				(t) => t.replace("resource: /references/attesters/check.py", "resource: 'references/attesters/check.py'"),
				"references/attesters/check.py",
			],
			[
				"a double-quoted field",
				(t) => t.replace("resource: /references/attesters/check.py", 'resource: "references/attesters/check.py"'),
				"references/attesters/check.py",
			],
		];
		for (const [name, edit, value] of cases) {
			it.effect(name, () =>
				Effect.gen(function* () {
					const { bundle, found } = yield* findingsOf(rootedWith(edit));
					const roots = found.filter((f) => f.code === "root-relative-path");
					assert.strictEqual(roots.length, 1);
					assert.strictEqual(covered(bundle, roots[0] as MigrationFinding), value);
					assert.strictEqual(roots[0]?.message.endsWith(`write it as "/${value}"`), true);
				}),
			);
		}

		it.effect("a sources[].resource descriptor and a URL yield nothing (control: a bare path beside them does)", () =>
			Effect.gen(function* () {
				const descriptor = yield* findingsOf(
					rootedWith((t) => t.replace("attester:", "sources:\n  - resource: all queries in project x\nattester:")),
				);
				assert.deepStrictEqual(rootRelative(descriptor.found), []);
				const url = yield* findingsOf(rootedWith((t) => t.replace("(/metrics/revenue.md)", "(https://x/y)")));
				assert.deepStrictEqual(rootRelative(url.found), []);
				const bare = yield* findingsOf(
					rootedWith((t) => t.replace("attester:", "sources:\n  - resource: metrics/revenue.md\nattester:")),
				);
				assert.strictEqual(rootRelative(bare.found).length, 1);
			}),
		);
	});

	it.effect("a declared 0.4 yields no version finding (control: 0.2 does)", () =>
		Effect.gen(function* () {
			const later = yield* findingsOf({
				...V03_PROJECT,
				"okf/index.md": (V03_PROJECT["okf/index.md"] as string).replace('"0.3"', '"0.4"'),
			});
			assert.deepStrictEqual(later.found, []);
			assert.isTrue((yield* findingsOf(V02_PROJECT)).found.some((f) => f.code === "okf-version-older"));
		}),
	);

	it.effect("computation-locator is reported only while the bundle reads with the legacy locator", () =>
		Effect.gen(function* () {
			const declared02 = yield* findingsOf(V02_PROJECT);
			const declared03 = yield* findingsOf({
				...V02_PROJECT,
				"okf/index.md": ERROR_PROJECTS["bare-path-under-0.3"]["okf/index.md"] as string,
			});
			assert.deepStrictEqual(declared02.found.filter((f) => f.code === "computation-locator").length, 1);
			assert.deepStrictEqual(declared03.found.filter((f) => f.code === "computation-locator").length, 0);
			// root-relative-path is reported whatever the bundle declares
			assert.strictEqual(declared03.found.filter((f) => f.code === "root-relative-path").length, 2);
		}),
	);

	it.effect("the computation-locator message and severity follow what the reading does", () =>
		Effect.gen(function* () {
			// depth-1 section with prose before its fence: legacy reads the section, current reads the fence; both read,
			// different text (a section that is only the fence reads the same and is not reported)
			const both = yield* findingsOf({
				...V02_PROJECT,
				[COMPUTATION]: (V02_PROJECT[COMPUTATION] as string).replace("## Computation\n", "# Computation\n\nRun it.\n"),
			});
			const bothFinding = both.found.find((f) => f.code === "computation-locator");
			assert.strictEqual(bothFinding?.severity, "info");
			assert.strictEqual(
				bothFinding?.message,
				"The Computation section reads differently under OKF 0.3 (§10.3): the first fenced block only",
			);
			// a section with no fence: legacy reads the prose, current finds nothing
			const lost = yield* findingsOf({
				...V02_PROJECT,
				[COMPUTATION]: (V02_PROJECT[COMPUTATION] as string)
					.replace(/```sql\n[^`]*```\n/, "Run the query.\n")
					.replace("## Computation", "# Computation"),
			});
			const lostFinding = lost.found.find((f) => f.code === "computation-locator");
			assert.strictEqual(lostFinding?.severity, "warning");
			assert.strictEqual(
				lostFinding?.message,
				"The Computation section reads differently under OKF 0.3 (§10.3): no fenced block, so the computation is missing",
			);
			// the heading's own line is the range
			assert.strictEqual(lostFinding?.range?.line, 14);
		}),
	);

	it.effect("a depth-1 Computation that is exactly one fence reads the same under both (controls still fire)", () =>
		Effect.gen(function* () {
			const computation = (replace: (text: string) => string) => ({
				...V02_PROJECT,
				[COMPUTATION]: replace(V02_PROJECT[COMPUTATION] as string),
			});
			const locator = (seed: ProjectSeed) =>
				findingsOf(seed).pipe(Effect.map(({ found }) => found.filter((f) => f.code === "computation-locator")));
			const same = yield* locator(computation((t) => t.replace("## Computation", "# Computation")));
			assert.deepStrictEqual(same, []);
			const trailing = yield* locator(
				computation((t) => t.replace("## Computation\n", "# Computation   \n\n\n").replace(/\n$/, "\n\n\n")),
			);
			assert.deepStrictEqual(trailing, []);
			// controls: each of these differs under 0.3
			const deeper = yield* locator(computation((t) => t));
			assert.deepStrictEqual(
				deeper.map((f) => f.severity),
				["info"],
			);
			const prose = yield* locator(
				computation((t) =>
					t.replace("## Computation\n", "# Computation\n\nRun it.\n\n").concat("\nThen:\n\n```sql\nSELECT 2\n```\n"),
				),
			);
			assert.deepStrictEqual(
				prose.map((f) => f.severity),
				["info"],
			);
			const proseFirst = yield* locator(
				computation((t) => t.replace("## Computation\n", "# Computation\n\nRun it.\n")),
			);
			assert.deepStrictEqual(
				proseFirst.map((f) => f.severity),
				["info"],
			);
			const proseOnly = yield* locator(
				computation((t) =>
					t.replace(/```sql\n[^`]*```\n/, "Run the query.\n").replace("## Computation", "# Computation"),
				),
			);
			assert.deepStrictEqual(
				proseOnly.map((f) => f.severity),
				["warning"],
			);
		}),
	);

	describe("computation-locator line endings (#483)", () => {
		/** The same concept as a real CRLF file: every line ending, frontmatter included, is CRLF. */
		const crlf = (text: string): string => text.replace(/\n/g, "\r\n");
		const locator = (text: string) =>
			findingsOf({ ...V02_PROJECT, [COMPUTATION]: text }).pipe(
				Effect.map(({ found }) => found.filter((f) => f.code === "computation-locator")),
			);
		const depth1 = (t: string) => t.replace("## Computation", "# Computation");

		it.effect("a CRLF section that is exactly one fence is unchanged, like its LF twin", () =>
			Effect.gen(function* () {
				const lf = depth1(V02_PROJECT[COMPUTATION] as string);
				assert.deepStrictEqual(yield* locator(lf), []);
				assert.deepStrictEqual(yield* locator(crlf(lf)), []);
			}),
		);

		it.effect("a CRLF section with prose beside the fence is still info, like its LF twin", () =>
			Effect.gen(function* () {
				const lf = (V02_PROJECT[COMPUTATION] as string).replace("## Computation\n", "# Computation\n\nRun it.\n");
				const a = yield* locator(lf);
				const b = yield* locator(crlf(lf));
				assert.deepStrictEqual(
					a.map((f) => f.severity),
					["info"],
				);
				assert.deepStrictEqual(
					b.map((f) => f.severity),
					["info"],
				);
				assert.strictEqual(a[0]?.message, b[0]?.message);
			}),
		);

		it.effect("a CRLF prose-only section is still a warning", () =>
			Effect.gen(function* () {
				const lf = depth1((V02_PROJECT[COMPUTATION] as string).replace(/```sql\n[^`]*```\n/, "Run the query.\n"));
				const found = yield* locator(crlf(lf));
				assert.deepStrictEqual(
					found.map((f) => f.severity),
					["warning"],
				);
			}),
		);
	});

	it.effect("a concept naming its computation file has no inline computation to compare", () =>
		Effect.gen(function* () {
			const { found } = yield* findingsOf({
				...V02_PROJECT,
				[COMPUTATION]: (V02_PROJECT[COMPUTATION] as string).replace(
					"runtime: sql\n",
					"runtime: sql\ncomputation: /references/attesters/check.py\n",
				),
			});
			assert.isFalse(found.some((f) => f.code === "computation-locator"));
		}),
	);
});

describe("run with a target", () => {
	const options = {
		root: ROOT,
		projectRoot: "/repo",
		config: CONFIG,
		profile: Option.none(),
		now: DateTime.makeUnsafe("2026-11-24T00:00:00Z"),
		skipProvenance: true,
	} as const;

	it.effect("adds the four migrate entries and leaves the lint entries identical", () =>
		Effect.gen(function* () {
			const plain = yield* run(options);
			const withTarget = yield* run({ ...options, target: "0.3" });
			assert.deepStrictEqual(plain.migration, []);
			assert.deepStrictEqual(summarize(withTarget.migration), [
				[FILE, "root-relative-path", "root-relative-path", 7],
				[FILE, "root-relative-path", "root-relative-path", 12],
				[FILE, "computation-locator", null, 14],
				["index.md", "okf-version-older", "okf-version", 1],
			]);
			const collected = collect(
				withTarget.report.conformance,
				withTarget.report.lint,
				withTarget.profileDiagnostics,
				withTarget.migration,
			);
			const migrate = collected.filter((d) => d.source === "migrate");
			assert.strictEqual(migrate.length, 4);
			assert.deepStrictEqual(
				migrate.map((d) => d.fix ?? null),
				["root-relative-path", "root-relative-path", null, "okf-version"],
			);
			// control: the lint entries equal a run without a target
			assert.deepStrictEqual(
				collected.filter((d) => d.source === "core.lint"),
				collect(plain.report.conformance, plain.report.lint, plain.profileDiagnostics).filter(
					(d) => d.source === "core.lint",
				),
			);
			assert.isAbove(collected.filter((d) => d.source === "core.lint").length, 0);
			// sort is unchanged: it orders migrate entries like any other
			assert.deepStrictEqual(
				sort(collected)
					.filter((d) => d.source === "migrate")
					.map((d) => d.code),
				["root-relative-path", "root-relative-path", "computation-locator", "okf-version-older"],
			);
		}).pipe(Effect.provide(sessionPlatform(mountProject(V02_PROJECT)))),
	);
});
