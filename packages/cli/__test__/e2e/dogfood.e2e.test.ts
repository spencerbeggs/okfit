// Acceptance suite for okfit's own dogfooded okf/ bundle (decisions.md
// F-13): a structural smoke check, not a content gate. Bundle content
// (warnings, drift, staleness, `okfit sync` having nothing to write) is
// checked by `pnpm okf:check` and the okf.yml workflow (#381), so ordinary
// authoring never turns this suite red. Repo root is resolved from THIS
// FILE's own location, never process.cwd(). Hermetic-sandbox exception:
// see packages/cli/__test__/CLAUDE.md.

import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Bundle } from "@okfit/core";
import { Effect } from "effect";
import { runOkfit } from "./utils/okfit.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const BUNDLE_ROOT = join(REPO_ROOT, "okf");

/** A floor, not an exact total: adding or deleting a concept must not break this suite. */
const MIN_CONCEPTS = 40;

/**
 * dirname of a bundle-relative posix path; "" for a root-level file.
 * Mirrors core/src/Derive.ts's own private `dirnameOf` helper, which is
 * not exported -- duplicated here rather than reached for internally.
 */
const dirnameOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

describe("okfit's own okf/ bundle: okfit validate (F-13 case a)", () => {
	it.effect(
		"exits 0 with no errors over the real bundle (warnings are reported by `pnpm okf:check`, not asserted here)",
		() =>
			Effect.gen(function* () {
				const result = yield* runOkfit(["validate", "--root", REPO_ROOT, "--format", "json"], {
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
						readonly profile_errors: number;
						readonly concepts: number;
					};
				};

				assert.strictEqual(envelope.summary.conformance_errors, 0);
				assert.strictEqual(envelope.summary.lint_errors, 0);
				assert.strictEqual(envelope.summary.profile_errors, 0);
				assert.isAtLeast(envelope.summary.concepts, MIN_CONCEPTS);
			}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit's own okf/ bundle: index completeness (F-13 case b)", () => {
	it.effect(
		"Bundle.load: every concept is linked from its directory's index.md, and no index.md links a file that is not a real concept",
		() =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: BUNDLE_ROOT });

				assert.isAtLeast(bundle.concepts.size, MIN_CONCEPTS);
				const project = [...bundle.concepts.values()].find((concept) => concept.path === "project.md");
				assert.isDefined(project, "project.md is missing");
				assert.strictEqual(project?.frontmatter.type, "Project");

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
			}).pipe(Effect.provide(NodeServices.layer)),
	);
});
