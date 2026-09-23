import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime, Effect, Exit, Option } from "effect";
import { humanActor } from "../../src/features/edits.js";
import type { SessionRegistryShape } from "../../src/session/registry.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { copyFixtureProject } from "../utils/fixture.js";
import { testPlatform, testPlatformWithGitDefect, testPlatformWithIdentity } from "../utils/platform.js";

/**
 * `humanActor` (`features/edits.ts`): the regression for the
 * `Effect.catchCause` -> `Effect.result` fix. `Effect.catchCause` recovers
 * from every failure mode a `Cause` can carry, defects and interrupts
 * included, so a `Git` subprocess crash inside `Derivation.generatedBy`
 * used to be swallowed identically to "no git identity configured" and read
 * as `Option.none()`. `Effect.result` converts only the typed
 * `GeneratedByError` channel; a defect must still propagate. Wired against
 * `makeSessionRegistry` directly, mirroring `hover.test.ts`'s lighter
 * harness -- no transport, no scheduler.
 */

/** Builds a registry over a fresh fixture copy and resolves its one folder's session. */
const setup = () =>
	Effect.gen(function* () {
		const { root } = yield* copyFixtureProject();
		const registry: SessionRegistryShape = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: () => Effect.void,
			onDispose: () => Effect.void,
		});
		yield* registry.setFolders([root]);
		const path = `${root}/okf/modules/alpha.md`;
		// `humanActor`'s `conceptSnapshot` needs a loaded bundle to find the
		// concept at `path`, so revalidate directly -- mirrors `hover.test.ts`'s
		// `openAndRevalidate`.
		const handle = Option.getOrThrow(yield* registry.sessionFor(path));
		const now = yield* DateTime.now;
		yield* handle.session.revalidate({ now, tier: "full" });
		return { registry, path };
	});

describe("humanActor", () => {
	it.effect(
		"a Git defect propagates rather than resolving to `Option.none()` (regression: not swallowed by catchCause)",
		() =>
			Effect.gen(function* () {
				const { registry, path } = yield* setup();
				const exit = yield* Effect.exit(humanActor(registry, path));
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					assert.isTrue(Cause.hasDies(exit.cause), `expected a died cause, got ${Cause.pretty(exit.cause)}`);
				}
			}).pipe(Effect.provide(testPlatformWithGitDefect())),
	);

	it.effect(
		"no git identity configured (a typed failure, not a defect) resolves to `Option.none()` (positive control above)",
		() =>
			Effect.gen(function* () {
				const { registry, path } = yield* setup();
				const actor = yield* humanActor(registry, path);
				assert.isTrue(Option.isNone(actor));
			}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("a resolved git identity resolves to `Some(actor)` (positive control above)", () =>
		Effect.gen(function* () {
			const { registry, path } = yield* setup();
			const actor = yield* humanActor(registry, path);
			assert.deepStrictEqual(actor, Option.some("human:fixture-author"));
		}).pipe(Effect.provide(testPlatformWithIdentity())),
	);
});
