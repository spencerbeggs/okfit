// Acceptance suite for okfit's own dogfooded okf/ bundle (phase-1 item 6,
// decisions.md F-13). (a) spawns the built dist/dev bin (K-43) against
// the repo's real okf/ bundle and asserts a clean validate summary now that
// every Decision concept carries a human verification (F-5 discharged); (b) loads the same
// bundle through @okfit/core's Bundle.load and asserts every concept is
// linked from its directory's index.md, both directions, using the real
// clock (DateTime.nowUnsafe(), D-10, D-34, SR5) rather than OKFIT_NOW,
// which has no effect on a direct @okfit/core call (K-47) since it is
// read only in bin.ts and case (b) never spawns the CLI.
//
// Repo root resolved from THIS FILE's own location, never process.cwd()
// -- four directories up (e2e -> __test__ -> cli -> packages).
//
// Hermetic-sandbox exception (packages/cli/__test__/CLAUDE.md, Step 4):
// this suite is not testing config discovery, so it passes real
// PATH/HOME explicitly rather than building a Sandbox.

import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Bundle, Derive } from "@okfit/core";
import { DateTime, Effect } from "effect";
import { runOkfit } from "./utils/okfit.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const BUNDLE_ROOT = join(REPO_ROOT, "okf");

/**
 * The bundle's concept inventory (F-1; bundle-content-inventory.md
 * section 5's groups, 5.1-5.6, with C3 shipping four Interfaces rather
 * than INVENTORY's proposed five -- see 03-conventions-interfaces.md's
 * "Decisions made here" #1): thirty-three concepts total.
 *
 * Every Decision carries `require_verified = true` and every one of the
 * thirteen was verified with `okfit verify` by Spencer (twelve on
 * 2026-09-07, the config-dir Decision on 2026-09-08), so the bundle
 * produces no diagnostics at all under core's default `error` severity.
 * Agents never write `verified`: a new Decision stays unverified, and this
 * test red, until Spencer verifies it from his own shell (C-28).
 */
const EXPECTED_CONCEPT_COUNTS = {
	Project: 1,
	Module: 7,
	Decision: 15,
	Convention: 7,
	Interface: 4,
	Reference: 1,
} as const;

const TOTAL_CONCEPTS = Object.values(EXPECTED_CONCEPT_COUNTS).reduce((sum, n) => sum + n, 0);

/**
 * dirname of a bundle-relative posix path; "" for a root-level file.
 * Mirrors core/src/Derive.ts's own private `dirnameOf` helper, which is
 * not exported -- duplicated here rather than reached for internally.
 */
const dirnameOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

describe("okfit's own okf/ bundle: okfit validate (F-13 case a)", () => {
	it.effect("exits 0 with no diagnostics at all: every Decision concept is human-verified", () =>
		Effect.gen(function* () {
			const result = yield* runOkfit(["validate", REPO_ROOT, "--format", "json"], {
				cwd: REPO_ROOT,
				env: {
					PATH: process.env.PATH ?? "",
					HOME: process.env.HOME ?? "",
					NO_COLOR: "1",
				},
			});

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "");

			const envelope = JSON.parse(result.stdout) as {
				readonly summary: {
					readonly conformance_errors: number;
					readonly lint_errors: number;
					readonly lint_warnings: number;
					readonly lint_info: number;
					readonly profile_errors: number;
					readonly concepts: number;
				};
				readonly diagnostics: ReadonlyArray<{
					readonly source: string;
					readonly code: string;
					readonly severity: string;
				}>;
			};

			assert.strictEqual(envelope.summary.conformance_errors, 0);
			assert.strictEqual(envelope.summary.lint_errors, 0);
			assert.strictEqual(envelope.summary.profile_errors, 0);
			assert.strictEqual(envelope.summary.concepts, TOTAL_CONCEPTS);
			// F-5 discharged 2026-09-07: every Decision is verified and the repo
			// config no longer overrides require_verified_unmet, so a clean
			// bundle reports nothing at all.
			assert.strictEqual(envelope.summary.lint_warnings, 0);
			assert.deepStrictEqual(envelope.diagnostics, []);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit's own okf/ bundle: index completeness (F-13 case b)", () => {
	it.effect(
		"Bundle.load: every concept is linked from its directory's index.md, and no index.md links a file that is not a real concept",
		() =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: BUNDLE_ROOT });
				const now = DateTime.nowUnsafe();

				assert.strictEqual(bundle.concepts.size, TOTAL_CONCEPTS);
				for (const [type, count] of Object.entries(EXPECTED_CONCEPT_COUNTS)) {
					const actual = [...bundle.concepts.values()].filter((concept) => concept.frontmatter.type === type).length;
					assert.strictEqual(actual, count, `expected ${count} ${type} concept(s), found ${actual}`);
				}

				for (const dir of bundle.directories) {
					const index = bundle.indexes.get(dir);
					assert.isDefined(index, `index.md missing for directory "${dir === "" ? "." : dir}"`);
					// "Subdirectories" is Derive.renderIndex's own trailing section for
					// child directories (packages/core/src/Derive.ts's renderIndex) --
					// never a concept-carrying section, so it is excluded from the
					// linked-target set both directions below check against.
					const conceptSections = (index?.sections ?? []).filter((section) => section.heading !== "Subdirectories");
					const linked = new Set(conceptSections.flatMap((section) => section.entries.map((entry) => entry.target)));

					const conceptsInDir = [...bundle.concepts.values()].filter((concept) => dirnameOf(concept.path) === dir);
					const expectedPaths = new Set(
						conceptsInDir.map((concept) => (dir === "" ? concept.path : concept.path.slice(dir.length + 1))),
					);

					// Forward direction (F-13's own requirement): every concept file
					// actually in this directory is linked from its index.md.
					for (const concept of conceptsInDir) {
						const target = dir === "" ? concept.path : concept.path.slice(dir.length + 1);
						assert.isTrue(
							linked.has(target),
							`${concept.path} is not linked from ${dir === "" ? "index.md" : `${dir}/index.md`}`,
						);
					}

					// Reverse direction (open-questions.md Q7's drift concern): a link
					// that names no real concept in this directory means the
					// hand-maintained index.md has already drifted from reality, which
					// core's own `missing-index` rule (file-presence only, never
					// content) never catches on its own.
					for (const target of linked) {
						assert.isTrue(
							expectedPaths.has(target),
							`${dir === "" ? "index.md" : `${dir}/index.md`} links "${target}", which is not a concept file in "${dir === "" ? "." : dir}"`,
						);
					}
				}

				// D-10/D-34/SR5: time is an explicit argument, never a Clock service
				// and never OKFIT_NOW (which has zero effect here, K-47) -- the real
				// clock, read once, so a genuinely stale concept would actually be
				// caught rather than silently skipped by an omitted `now`.
				for (const concept of bundle.concepts.values()) {
					assert.notStrictEqual(
						Derive.staleness(concept.frontmatter, now),
						"stale",
						`${concept.path} is already stale`,
					);
				}
			}).pipe(Effect.provide(NodeServices.layer)),
	);
});
