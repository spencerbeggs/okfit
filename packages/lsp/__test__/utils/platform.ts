import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Git } from "@effected/git";
import type { AppDirs as AppDirsType, Xdg as XdgType } from "@effected/xdg";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { GitHistory } from "@okfit/profiles";
import type { Crypto, FileSystem, Path } from "effect";
import { Effect, Layer, Option } from "effect";
import type { SessionRegistryServices } from "../../src/session/registry.js";

/** Layers memoize by reference; bind these once per file rather than reconstructing them per call. */
const gitHistoryTest = GitHistory.layerTest({});

/**
 * `configGet` always answers `Option.none()`: the real production shape of
 * "no git identity configured" (`Derivation.generatedBy` resolves
 * `HumanActorUnresolvedError`, a typed failure) -- not
 * `Git.layerTest({})`'s own unstubbed-method die, which models a test
 * double's own bug, never a production outcome.
 */
const gitTest = Git.layerTest({
	configGet: () => Effect.succeed(Option.none()),
});

/**
 * The identity a git checkout serves back for {@link testPlatformWithIdentity}: local part
 * `fixture-author`, matching every fixture's own `generated.by`/`verified[].by`
 * (`"human:fixture-author"`, `Derivation.humanActorId`'s email-local-part rule).
 */
const FIXTURE_IDENTITY_EMAIL = "fixture-author@example.com";
const FIXTURE_IDENTITY_NAME = "Fixture Author";

/** `configGet("user.name"|"user.email")` answers the fixture identity; every other override dies, same as `Git.layerTest({})`. */
const gitIdentityTest = Git.layerTest({
	configGet: (_cwd, key) => {
		if (key === "user.email") return Effect.succeed(Option.some(FIXTURE_IDENTITY_EMAIL));
		if (key === "user.name") return Effect.succeed(Option.some(FIXTURE_IDENTITY_NAME));
		return Effect.succeed(Option.none());
	},
});

/** `configGet` dies instead of failing typed -- the positive control that a `Git` defect propagates rather than reading as "no identity". */
const gitConfigGetDiesTest = Git.layerTest({
	configGet: () => Effect.die(new Error("okfit-lsp test: Git.configGet defect")),
});

/** Fresh, per-call temp XDG directories, mirroring `packages/engine/__test__/config/resolve.test.ts:19-34`. */
const testEnv = (): Layer.Layer<AppDirsType | XdgType | FileSystem.FileSystem | Path.Path | Crypto.Crypto> => {
	const home = mkdtempSync(join(tmpdir(), "okfit-lsp-xdg-"));
	const testXdg: Layer.Layer<XdgType> = Xdg.layerFrom(
		XdgPaths.make({
			home,
			configHome: join(home, ".config"),
			dataHome: join(home, ".local", "share"),
			cacheHome: join(home, ".cache"),
			stateHome: join(home, ".local", "state"),
			configDirs: [],
			dataDirs: [],
		}),
	);

	return AppDirs.layer({ namespace: "okfit" }).pipe(
		Layer.provideMerge(testXdg),
		Layer.provideMerge(NodeServices.layer),
	);
};

/**
 * `SessionRegistryServices` over fresh, per-call temp XDG directories.
 * `configGet` always answers `Option.none()`, so `Derivation.generatedBy`
 * fails its typed `HumanActorUnresolvedError` -- `@okfit/lsp`'s own
 * actor-resolution helpers catch that and answer `Option.none()`, so this
 * layer alone already proves "no git identity to derive an actor from".
 *
 * @public
 */
export const testPlatform = (): Layer.Layer<SessionRegistryServices> =>
	Layer.mergeAll(testEnv(), gitTest, gitHistoryTest);

/**
 * As {@link testPlatform}, but `configGet("user.name"|"user.email")`
 * resolves to a real identity (`Derivation.generatedBy` resolves
 * `"human:fixture-author"`) -- the positive control for a code action whose
 * title or edit depends on the resolved actor. Layers memoize by reference:
 * bind this once per file rather than reconstructing it per call.
 *
 * @public
 */
export const testPlatformWithIdentity = (): Layer.Layer<SessionRegistryServices> =>
	Layer.mergeAll(testEnv(), gitIdentityTest, gitHistoryTest);

/**
 * As {@link testPlatform}, but `configGet` dies instead of failing typed:
 * the positive control that a `Git` defect (a subprocess crash, say)
 * propagates out of `Derivation.generatedBy` and its callers rather than
 * being read as "no identity to resolve".
 *
 * @public
 */
export const testPlatformWithGitDefect = (): Layer.Layer<SessionRegistryServices> =>
	Layer.mergeAll(testEnv(), gitConfigGetDiesTest, gitHistoryTest);

/**
 * As {@link testPlatformWithIdentity}, but every `configGet("user.email")`
 * call increments `counter.email` first -- one per human-actor resolution
 * (`Derivation.generatedBy` reads `user.email` exactly once), so a test can
 * assert how many resolutions a feature made.
 *
 * @public
 */
export const testPlatformCountingIdentity = (counter: { email: number }): Layer.Layer<SessionRegistryServices> =>
	Layer.mergeAll(
		testEnv(),
		Git.layerTest({
			configGet: (_cwd, key) => {
				if (key === "user.email") {
					counter.email++;
					return Effect.succeed(Option.some(FIXTURE_IDENTITY_EMAIL));
				}
				if (key === "user.name") return Effect.succeed(Option.some(FIXTURE_IDENTITY_NAME));
				return Effect.succeed(Option.none());
			},
		}),
		gitHistoryTest,
	);
