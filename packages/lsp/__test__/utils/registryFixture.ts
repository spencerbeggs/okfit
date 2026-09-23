import { DateTime, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import type { ConceptsFeature } from "../../src/features/concepts.js";
import { notifyBundleChanged } from "../../src/features/concepts.js";
import { makeRevalidatePublisher } from "../../src/features/diagnostics.js";
import type { LspTransportShape } from "../../src/protocol/LspTransport.js";
import type { SessionRegistryShape } from "../../src/session/registry.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { makeCapturingRecordingTransport, makeCapturingTransport } from "./fakeTransport.js";
import { makeTempBundle } from "./tempBundle.js";

/**
 * Shared setup for a feature test that needs one live, revalidated session
 * over a temp bundle and a capturing transport bound to the feature under
 * test's own `register*` function. Builds the temp bundle from `files`,
 * registers `register` on a fresh capturing transport, sets the bundle root
 * as the one workspace folder, and revalidates its session at the `full`
 * tier so `bundle()` is populated before `call` is used.
 *
 * `register`'s test still owns its own `concept`/config fixture strings
 * (kept local so each test file reads standalone); only this repeated
 * registry-wiring dance -- `symbols.test.ts`'s original `setup` -- lives
 * here, shared with `concepts.test.ts`.
 */
export const setupRegistry = (
	register: (transport: LspTransportShape, registry: SessionRegistryShape) => Effect.Effect<unknown>,
	files: Readonly<Record<string, string>>,
) =>
	Effect.gen(function* () {
		const { root } = yield* makeTempBundle(files);
		const { transport, call } = makeCapturingTransport();
		const registry = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: () => Effect.void,
			onDispose: () => Effect.void,
		});
		yield* register(transport, registry);
		yield* registry.setFolders([root]);
		// Any path under root resolves to the one session this bundle owns.
		const handle = Option.getOrThrow(yield* registry.sessionFor(root));
		// it.effect provides TestClock, whose virtual clock starts at the epoch (effect/testing/TestClock.ts);
		// DateTime.now inside a registered request handler reads that same virtual clock, so an unadjusted
		// clock would resolve every "now" to 1970-01-01 -- before any real fixture's `stale_after`.
		yield* TestClock.setTime(Date.now());
		const now = yield* DateTime.now;
		yield* handle.session.revalidate({ now, tier: "full" });
		return { root, call };
	});

/**
 * Two independent temp bundles, each its own workspace folder, both
 * revalidated; returns a `call` bound across both live sessions.
 * `symbols.test.ts`'s original `setupTwoFolders`, now shared with
 * `concepts.test.ts`.
 */
export const setupTwoFoldersRegistry = (
	register: (transport: LspTransportShape, registry: SessionRegistryShape) => Effect.Effect<unknown>,
	filesA: Readonly<Record<string, string>>,
	filesB: Readonly<Record<string, string>>,
) =>
	Effect.gen(function* () {
		const { root: rootA } = yield* makeTempBundle(filesA);
		const { root: rootB } = yield* makeTempBundle(filesB);
		const { transport, call } = makeCapturingTransport();
		const registry = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: () => Effect.void,
			onDispose: () => Effect.void,
		});
		yield* register(transport, registry);
		yield* registry.setFolders([rootA, rootB]);
		yield* TestClock.setTime(Date.now());
		for (const root of [rootA, rootB]) {
			const handle = Option.getOrThrow(yield* registry.sessionFor(root));
			const now = yield* DateTime.now;
			yield* handle.session.revalidate({ now, tier: "full" });
		}
		return { rootA, rootB, call };
	});

/**
 * A registry wired with the same `onRevalidate`/`onDispose` shape
 * `server.ts` builds (the real `makeRevalidatePublisher`'s `publish`/`clear`,
 * plus `notifyBundleChanged`), so a scheduler-driven revalidate -- including
 * `registerConcepts`'s own warm-up -- actually loads the bundle and sends the
 * notifications a client would see, instead of the other fixtures' plain
 * `Effect.void` stub. No folder is set and no session is built here: the
 * caller sets folders (`registry.setFolders`) to exercise the warm-up path
 * itself.
 *
 * `register` must be `registerConcepts` itself (or something with the same
 * shape): its returned `ConceptsFeature.forgetWarmup` is threaded into
 * `onDispose` through the same forward-reference box `server.ts` uses,
 * *unless* `wireForgetWarmup` is explicitly `false` -- the negative control
 * a caller uses to prove a test that exercises this wiring can actually
 * fail. `registerConcepts` is called after the registry exists (it needs
 * `registry` itself), so the box is necessary here for the same reason it is
 * in `server.ts`: `onDispose` is a registry constructor option, and the
 * registry must exist before `registerConcepts` can be built.
 */
export const setupWarmupRegistry = (
	register: (transport: LspTransportShape, registry: SessionRegistryShape) => Effect.Effect<ConceptsFeature>,
	options: { readonly wireForgetWarmup?: boolean } = {},
) =>
	Effect.gen(function* () {
		const wireForgetWarmup = options.wireForgetWarmup ?? true;
		const { transport, call, notifications } = makeCapturingRecordingTransport();
		const publisher = yield* makeRevalidatePublisher(transport);
		const conceptsBox: { forgetWarmup: ((root: string) => Effect.Effect<void>) | undefined } = {
			forgetWarmup: undefined,
		};
		const registry = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: (handle, tier) =>
				Effect.andThen(
					publisher.publish(handle, tier),
					notifyBundleChanged(transport, handle.bundleRoot, "revalidated"),
				),
			onDispose: (handle) =>
				Effect.andThen(
					Effect.andThen(
						publisher.clear(handle.bundleRoot),
						notifyBundleChanged(transport, handle.bundleRoot, "dropped"),
					),
					Effect.suspend(() =>
						wireForgetWarmup ? (conceptsBox.forgetWarmup?.(handle.bundleRoot) ?? Effect.void) : Effect.void,
					),
				),
		});
		const feature = yield* register(transport, registry);
		conceptsBox.forgetWarmup = feature.forgetWarmup;
		return { call, notifications, registry };
	});
