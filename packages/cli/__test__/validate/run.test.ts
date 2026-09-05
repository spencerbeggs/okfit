import { resolve } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { BundleRootNotFoundError, OkfitConfig } from "@okfit/core";
import { Profiles } from "@okfit/profiles";
import { DateTime, Effect, Layer, Option } from "effect";
import { Now, run } from "../../src/validate/run.js";

// K-44: no CLI-owned fixtures. Profiles' clean bundle is read IN PLACE, by
// absolute path; this suite only loads and validates, it never writes.
const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");
/** Real disk, read-only static fixtures (precedent: PROFILES/__test__/SoftwareProject.check.test.ts). */
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const now = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
const profile = Profiles.softwareProject;
const merged = OkfitConfig.merge(OkfitConfig.DEFAULTS, profile.config);

describe("run", () => {
	it.effect("loads, runs both tiers and the profile check, and collects into one RunResult", () =>
		Effect.gen(function* () {
			const root = resolve(PROFILES_FIXTURES, "software-project");
			const result = yield* run({ root, config: merged, profile: Option.some(profile), now });
			assert.strictEqual(result.bundle.root, root);
			assert.deepStrictEqual(result.report.conformance, []);
			assert.deepStrictEqual(result.report.lint, []);
			assert.deepStrictEqual(result.profileDiagnostics, []);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("profile None yields an empty profileDiagnostics array without calling any check", () =>
		Effect.gen(function* () {
			const root = resolve(PROFILES_FIXTURES, "software-project");
			const result = yield* run({ root, config: merged, profile: Option.none(), now });
			assert.deepStrictEqual(result.profileDiagnostics, []);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a bundle root that does not exist fails with BundleRootNotFoundError before any profile check runs", () =>
		Effect.gen(function* () {
			const root = resolve(PROFILES_FIXTURES, "does-not-exist");
			const error = yield* Effect.flip(run({ root, config: merged, profile: Option.some(profile), now }));
			assert.isTrue(error instanceof BundleRootNotFoundError);
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
