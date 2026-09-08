import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { BundleRootNotFoundError, OkfitConfig } from "@okfit/core";
import { GitHistory, PathHistoryEntry, Profiles } from "@okfit/profiles";
import { DateTime, Effect, Layer, Option } from "effect";
import { Now, run } from "../../src/validate/run.js";

// K-44: no CLI-owned fixtures. Profiles' clean bundle is read IN PLACE, by
// absolute path; this suite only loads and validates, it never writes.
const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");
/**
 * Real disk, read-only static fixtures (precedent: PROFILES/__test__/SoftwareProject.check.test.ts).
 * `run` now also requires `Git | GitHistory` (contract §10.1, S-16) for its
 * `Provenance.lint` call — real layers over `NodeServices.layer`'s
 * `ChildProcessSpawner`, since this fixture tree lives inside the real
 * okfit git repository and the drift lint genuinely walks it.
 */
const platform = Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(NodeServices.layer));
const now = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
const profile = Profiles.softwareProject;
const merged = OkfitConfig.merge(OkfitConfig.DEFAULTS, profile.config);
/**
 * This suite is about `run`'s own tier/profile-check plumbing, not the
 * `generated-at-drift` lint itself. The `software-project` fixture's
 * `project.md` genuinely drifts against this repository's real git
 * history (its `generated.at` records a rounded clock time, not the
 * actual commit's author instant), so `generated_at_drift` is turned
 * `"off"` here to keep this suite's assertions independent of that
 * fixture fact and of the real git history it walks.
 */
const mergedNoDrift = OkfitConfig.merge(merged, { extensions: {}, lint: { generated_at_drift: "off" } });

describe("run", () => {
	it.effect("loads, runs both tiers and the profile check, and collects into one RunResult", () =>
		Effect.gen(function* () {
			const root = resolve(PROFILES_FIXTURES, "software-project");
			const result = yield* run({ root, config: mergedNoDrift, profile: Option.some(profile), now });
			assert.strictEqual(result.bundle.root, root);
			assert.deepStrictEqual(result.report.conformance, []);
			assert.deepStrictEqual(result.report.lint, []);
			assert.deepStrictEqual(result.profileDiagnostics, []);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("profile None yields an empty profileDiagnostics array without calling any check", () =>
		Effect.gen(function* () {
			const root = resolve(PROFILES_FIXTURES, "software-project");
			const result = yield* run({ root, config: mergedNoDrift, profile: Option.none(), now });
			assert.deepStrictEqual(result.profileDiagnostics, []);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a bundle root that does not exist fails with BundleRootNotFoundError before any profile check runs", () =>
		Effect.gen(function* () {
			const root = resolve(PROFILES_FIXTURES, "does-not-exist");
			const error = yield* Effect.flip(run({ root, config: merged, profile: Option.some(profile), now }));
			if (!(error instanceof BundleRootNotFoundError)) return assert.fail("expected a BundleRootNotFoundError");
			assert.strictEqual(error.root, root);
		}).pipe(Effect.provide(platform)),
	);
});

/**
 * `generated-at-drift` (S-16) exercised over a temp on-disk bundle (one
 * concept, real `Bundle.load`) and SCRIPTED `Git`/`GitHistory` doubles —
 * never this repository's own history. `Git.layerTest`/`GitHistory.layerTest`
 * mirror the exact double shape `packages/profiles/__test__/Provenance.test.ts`
 * already uses; not imported from there (test utils never cross packages,
 * S-17) — this suite scripts its own minimal `Git`/`GitHistory` layers
 * directly. Every OTHER lint code is turned `off` so `report.lint`'s
 * length reflects only `generated-at-drift`, not incidental
 * `unknown-type`/`missing-index` noise from a deliberately minimal
 * one-file bundle.
 */
const ONLY_DRIFT_LINT: OkfitConfig["lint"] = {
	broken_links: "off",
	missing_index: "off",
	unknown_type: "off",
	required_key_missing: "off",
	field_value_unknown: "off",
	require_verified_unmet: "off",
	family_invalid: "off",
	computation_runtime_missing: "off",
	footnote_source_unknown: "off",
	log_frontmatter: "off",
	actor_prefix_unknown: "off",
	legacy_timestamp: "off",
	config_unknown_key: "off",
	stale: "off",
	walk_unreadable: "off",
	generated_at_drift: "info",
};
const driftConfig: OkfitConfig = { ...OkfitConfig.DEFAULTS, types: { Module: {} }, lint: ONLY_DRIFT_LINT };

const REL = "project.md";
const SHA = "1f0f58d1234567890abcdef1234567890abcdef";
const AUTHORED_AT = "2026-01-05T12:00:00Z";

const fileText = (generatedAt: string) =>
	`---\ntype: Module\ngenerated:\n  by: human:okfit-test\n  at: ${generatedAt}\n---\n\n# Thing\n\nBody text.\n`;

/** One committed, single-entry history whose body-at-HEAD equals `body` verbatim. */
const scriptedGit = (root: string, body: string): Layer.Layer<Git> =>
	Git.layerTest({
		repoRoot: () => Effect.succeed(root),
		show: (_cwd, ref) => (ref === "HEAD" ? Effect.succeed(Option.some(body)) : Effect.succeed(Option.none())),
	});

const scriptedHistory: Layer.Layer<GitHistory> = GitHistory.layerTest({
	[REL]: [
		PathHistoryEntry.make({
			sha: SHA,
			authoredAt: DateTime.makeUnsafe(AUTHORED_AT),
			committedAt: DateTime.makeUnsafe(AUTHORED_AT),
			authorName: "Ada Lovelace",
			authorEmail: "ada@example.com",
			path: REL,
		}),
	],
});

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("run — generated-at-drift lint (scripted history)", () => {
	it.effect("appends one generated-at-drift diagnostic when the recorded at differs from the derived instant", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-run-drift-")));
			try {
				const text = fileText("2020-01-01T00:00:00Z"); // deliberately not AUTHORED_AT
				yield* Effect.promise(() => writeFile(join(root, REL), text));
				const result = yield* run({ root, config: driftConfig, profile: Option.none(), now }).pipe(
					Effect.provide(Layer.mergeAll(scriptedGit(root, text), scriptedHistory)),
				);
				assert.strictEqual(result.report.lint.length, 1);
				assert.strictEqual(result.report.lint[0]?.code, "generated-at-drift");
				assert.strictEqual(result.report.lint[0]?.file, REL);
				assert.include(result.report.lint[0]?.message ?? "", "generated.at is 2020-01-01T00:00:00Z");
				assert.include(result.report.lint[0]?.message ?? "", AUTHORED_AT);
				assert.include(result.report.lint[0]?.message ?? "", SHA.slice(0, 7));
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(nodePlatform)),
	);

	it.effect("appends no diagnostic when the recorded at already matches the derived instant", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-run-nodrift-")));
			try {
				const text = fileText(AUTHORED_AT); // matches the scripted entry's authoredAt exactly
				yield* Effect.promise(() => writeFile(join(root, REL), text));
				const result = yield* run({ root, config: driftConfig, profile: Option.none(), now }).pipe(
					Effect.provide(Layer.mergeAll(scriptedGit(root, text), scriptedHistory)),
				);
				assert.deepStrictEqual(result.report.lint, []);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(nodePlatform)),
	);
});

describe("Now", () => {
	it.effect("is a Context.Service carrying a DateTime.Utc, providable with Effect.provideService", () =>
		Effect.gen(function* () {
			const read = yield* Now;
			assert.strictEqual(DateTime.formatIso(read), "2026-09-05T00:00:00.000Z");
		}).pipe(Effect.provideService(Now, now)),
	);
});
