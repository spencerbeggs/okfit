import { resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { BundleRootNotFoundError, OkfitConfig } from "@okfit/core";
import { GitHistory, Profiles } from "@okfit/profiles";
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
 * `generated-at-drift` lint itself (that lint's own behavior is A2's
 * `Provenance.test.ts`, run against doubles). The `software-project`
 * fixture's `project.md` genuinely drifts against this repository's real
 * git history (its `generated.at` records a rounded clock time, not the
 * actual commit's author instant), so `generated_at_drift` is turned
 * `"off"` here to keep this suite's assertions independent of that fixture
 * fact and of the real git history it walks.
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

	it.effect("runs the generated-at-drift lint and appends its diagnostics to report.lint when not off", () =>
		Effect.gen(function* () {
			const root = resolve(PROFILES_FIXTURES, "software-project");
			const result = yield* run({ root, config: merged, profile: Option.some(profile), now });
			assert.strictEqual(result.report.lint.length, 1);
			assert.strictEqual(result.report.lint[0]?.code, "generated-at-drift");
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

describe("Now", () => {
	it.effect("is a Context.Service carrying a DateTime.Utc, providable with Effect.provideService", () =>
		Effect.gen(function* () {
			const read = yield* Now;
			assert.strictEqual(DateTime.formatIso(read), "2026-09-05T00:00:00.000Z");
		}).pipe(Effect.provideService(Now, now)),
	);
});
