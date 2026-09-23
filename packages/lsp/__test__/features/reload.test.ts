import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { pathToUri } from "../../src/convert/uri.js";
import { makeDiagnosticsFeature, makeRevalidatePublisher } from "../../src/features/diagnostics.js";
import type { LspTransportShape } from "../../src/protocol/LspTransport.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { copyFixtureProject } from "../utils/fixture.js";
import { testPlatform } from "../utils/platform.js";

/**
 * Config-reload and dropped-session cleanup, task 4 of the phase 4 plan
 * (`okf/limitations/no-config-reload-in-phase-3.md`). These tests wire
 * `makeSessionRegistry` + `makeRevalidatePublisher` + `makeDiagnosticsFeature`
 * directly, the same three constructors `server.ts` composes, against a fake
 * transport that only records `sendNotification` calls -- no JSON-RPC round
 * trip, so `it.effect`'s virtual clock governs every debounce with
 * `TestClock.adjust`, unlike `server.test.ts`'s `it.live` harness.
 */

const platform = testPlatform();

/** The "old" config for test (a) and (b): status_missing "warn" instead of the base fixture's "off". */
const OLD_CONFIG_VARIANT_PATH = fileURLToPath(new URL("../fixtures/config-variant.okfit.toml", import.meta.url));
/** Malformed TOML, same as `registry.test.ts`'s: never builds a session. */
const BROKEN_CONFIG = "[lint\nbroken = ";
/** Replaces alpha.md's one link with a dangling one; used against any file whose disk text contains that line. */
const BROKEN_LINK = (text: string) => text.replace("See [Beta](beta.md).", "See [Nowhere](nowhere.md).");

interface RecordedPublish {
	readonly uri: string;
	readonly diagnostics: ReadonlyArray<{ readonly code?: string | number }>;
}

interface RecordedNotification {
	readonly method: string;
	readonly params: unknown;
}

const die = (name: string) => (): Effect.Effect<never> =>
	Effect.die(`fake transport: ${name} is not used by this test`);

/** A transport whose `sendNotification` records every call; every other member dies if called. */
const makeRecordingTransport = (): {
	readonly transport: LspTransportShape;
	readonly notifications: Array<RecordedNotification>;
} => {
	const notifications: Array<RecordedNotification> = [];
	const transport = {
		onInitialize: die("onInitialize"),
		onInitialized: die("onInitialized"),
		onShutdown: die("onShutdown"),
		onRequest: die("onRequest"),
		onNotification: die("onNotification"),
		sendNotification: (method: string, params: unknown) =>
			Effect.sync(() => void notifications.push({ method, params })),
		sendRequest: die("sendRequest"),
		listen: Effect.die("fake transport: listen is not used by this test"),
	} as unknown as LspTransportShape;
	return { transport, notifications };
};

/** Every `textDocument/publishDiagnostics` call recorded so far, in order. */
const published = (notifications: ReadonlyArray<RecordedNotification>): ReadonlyArray<RecordedPublish> =>
	notifications
		.filter((notification) => notification.method === "textDocument/publishDiagnostics")
		.map((notification) => notification.params as RecordedPublish);

/** A fresh fixture copy wired with a real registry, publisher and diagnostics feature; one workspace folder, `root`. */
const setup = () =>
	Effect.gen(function* () {
		const { root } = yield* copyFixtureProject();
		const { transport, notifications } = makeRecordingTransport();
		const publisher = yield* makeRevalidatePublisher(transport);
		const registry = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: publisher.publish,
			onDispose: (handle) => publisher.clear(handle.bundleRoot),
		});
		const feature = yield* makeDiagnosticsFeature(registry);
		yield* registry.setFolders([root]);
		return {
			root,
			registry,
			feature,
			notifications,
			alphaPath: join(root, "okf", "modules", "alpha.md"),
			betaPath: join(root, "okf", "modules", "beta.md"),
			configPath: join(root, ".okfit.toml"),
		};
	});

describe("config reload and dropped-session cleanup", () => {
	it.effect(
		"(a) a config change clears a diagnostic the new config drops, exactly once; a file whose diagnostics never appear is never published",
		() =>
			Effect.gen(function* () {
				const { root, registry, feature, notifications, alphaPath, betaPath, configPath } = yield* setup();
				const baseConfig = yield* Effect.promise(() => readFile(configPath, "utf8"));
				const oldConfig = yield* Effect.promise(() => readFile(OLD_CONFIG_VARIANT_PATH, "utf8"));
				yield* Effect.promise(() => writeFile(configPath, oldConfig, "utf8"));

				const alphaUri = pathToUri(alphaPath);
				const betaUri = pathToUri(betaPath);
				const gammaPath = join(root, "okf", "modules", "gamma.md");
				const gammaUri = pathToUri(gammaPath);
				// gamma.md exists only in the overlay, with an explicit status, so status_missing never
				// flags it under either config: it is the "never touched" control.
				const gammaText =
					"---\ntype: Module\ntitle: Gamma\ndescription: A control concept that never has a diagnostic.\nresource: gamma.md\nkind: package\nstatus: stable\n---\n\n# Gamma\n";

				yield* feature.onDocumentEvent({
					kind: "open",
					path: alphaPath,
					text: yield* Effect.promise(() => readFile(alphaPath, "utf8")),
					version: 1,
				});
				yield* feature.onDocumentEvent({
					kind: "open",
					path: betaPath,
					text: yield* Effect.promise(() => readFile(betaPath, "utf8")),
					version: 1,
				});
				yield* feature.onDocumentEvent({ kind: "open", path: gammaPath, text: gammaText, version: 1 });
				let handle = Option.getOrThrow(yield* registry.sessionFor(alphaPath));
				yield* TestClock.adjust("20 millis");
				yield* handle.scheduler.settle;

				const initial = published(notifications);
				assert.isTrue(
					initial.some((p) => p.uri === alphaUri && p.diagnostics.some((d) => d.code === "status-missing")),
				);
				assert.isTrue(initial.some((p) => p.uri === betaUri && p.diagnostics.some((d) => d.code === "status-missing")));
				assert.isFalse(initial.some((p) => p.uri === gammaUri));

				notifications.length = 0;
				yield* Effect.promise(() => writeFile(configPath, baseConfig, "utf8"));
				yield* feature.onWatchedFiles([configPath]);
				handle = Option.getOrThrow(yield* registry.sessionFor(alphaPath));
				yield* TestClock.adjust("20 millis");
				yield* handle.scheduler.settle;

				const afterSwap = published(notifications);
				assert.deepStrictEqual(
					afterSwap.filter((p) => p.uri === alphaUri),
					[{ uri: alphaUri, diagnostics: [] }],
				);
				assert.deepStrictEqual(
					afterSwap.filter((p) => p.uri === betaUri),
					[{ uri: betaUri, diagnostics: [] }],
				);
				// gamma is unaffected by the config swap: still never published, over the whole test.
				assert.isFalse(published(notifications).some((p) => p.uri === gammaUri));
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"(b) an open document with unsaved text is validated from its overlay after a config-change rebuild, not from disk",
		() =>
			Effect.gen(function* () {
				const { registry, feature, notifications, alphaPath, configPath } = yield* setup();
				const baseConfig = yield* Effect.promise(() => readFile(configPath, "utf8"));
				const alphaOnDisk = yield* Effect.promise(() => readFile(alphaPath, "utf8"));
				const brokenOverlay = BROKEN_LINK(alphaOnDisk);
				const alphaUri = pathToUri(alphaPath);

				yield* feature.onDocumentEvent({ kind: "open", path: alphaPath, text: brokenOverlay, version: 1 });
				let handle = Option.getOrThrow(yield* registry.sessionFor(alphaPath));
				yield* TestClock.adjust("20 millis");
				yield* handle.scheduler.settle;
				assert.isTrue(
					published(notifications).some(
						(p) => p.uri === alphaUri && p.diagnostics.some((d) => d.code === "broken-links"),
					),
				);

				notifications.length = 0;
				// Re-saving the same config content is still a config-file event (the watcher matches by
				// basename, not by content), so this exercises the rebuild path without also changing what
				// alpha.md's diagnostics *should* be -- isolating the overlay-carry behaviour this test targets.
				yield* Effect.promise(() => writeFile(configPath, baseConfig, "utf8"));
				yield* feature.onWatchedFiles([configPath]);
				handle = Option.getOrThrow(yield* registry.sessionFor(alphaPath));
				yield* TestClock.adjust("20 millis");
				yield* handle.scheduler.settle;

				// Disk still has the clean, un-broken alpha.md: had the overlay not carried over, the rebuilt
				// session would validate that and publish nothing further for it.
				assert.isTrue(
					published(notifications).some(
						(p) => p.uri === alphaUri && p.diagnostics.some((d) => d.code === "broken-links"),
					),
				);
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"(c) removing a workspace folder clears every URI it had published non-empty, once; a URI already cleared gets no second []",
		() =>
			Effect.gen(function* () {
				const { root, registry, feature, notifications, alphaPath, betaPath } = yield* setup();
				const alphaBroken = BROKEN_LINK(yield* Effect.promise(() => readFile(alphaPath, "utf8")));
				const betaOnDisk = yield* Effect.promise(() => readFile(betaPath, "utf8"));
				const betaBroken = `${betaOnDisk}\nSee [Nowhere](nowhere.md).\n`;
				const alphaUri = pathToUri(alphaPath);
				const betaUri = pathToUri(betaPath);

				yield* feature.onDocumentEvent({ kind: "open", path: alphaPath, text: alphaBroken, version: 1 });
				yield* feature.onDocumentEvent({ kind: "open", path: betaPath, text: betaBroken, version: 1 });
				let handle = Option.getOrThrow(yield* registry.sessionFor(alphaPath));
				yield* TestClock.adjust("20 millis");
				yield* handle.scheduler.settle;
				assert.isTrue(published(notifications).some((p) => p.uri === alphaUri && p.diagnostics.length > 0));
				assert.isTrue(published(notifications).some((p) => p.uri === betaUri && p.diagnostics.length > 0));

				notifications.length = 0;
				// Fix beta only: its own next revalidate publishes [] and forgets it -- an ordinary publish,
				// not a dispose. This is the "already cleared" URI the removal below must not touch again.
				yield* feature.onDocumentEvent({ kind: "change", path: betaPath, text: betaOnDisk, version: 2 });
				handle = Option.getOrThrow(yield* registry.sessionFor(betaPath));
				yield* TestClock.adjust("20 millis");
				yield* handle.scheduler.settle;
				assert.deepStrictEqual(
					published(notifications).filter((p) => p.uri === betaUri),
					[{ uri: betaUri, diagnostics: [] }],
				);

				notifications.length = 0;
				yield* registry.removeFolders([root]);
				// Only alpha, still remembered non-empty, is cleared by the removal.
				assert.deepStrictEqual(published(notifications), [{ uri: alphaUri, diagnostics: [] }]);
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"(d) rebuilding into a config that fails to load clears diagnostics; the next didOpen retries and republishes",
		() =>
			Effect.gen(function* () {
				const { registry, feature, notifications, alphaPath, configPath } = yield* setup();
				const goodConfig = yield* Effect.promise(() => readFile(configPath, "utf8"));
				const alphaBroken = BROKEN_LINK(yield* Effect.promise(() => readFile(alphaPath, "utf8")));
				const alphaUri = pathToUri(alphaPath);

				yield* feature.onDocumentEvent({ kind: "open", path: alphaPath, text: alphaBroken, version: 1 });
				let handle = Option.getOrThrow(yield* registry.sessionFor(alphaPath));
				yield* TestClock.adjust("20 millis");
				yield* handle.scheduler.settle;
				assert.isTrue(published(notifications).some((p) => p.uri === alphaUri && p.diagnostics.length > 0));

				notifications.length = 0;
				yield* Effect.promise(() => writeFile(configPath, BROKEN_CONFIG, "utf8"));
				yield* feature.onWatchedFiles([configPath]);
				// The broken config never builds a session; the dispose above already cleared what the old one published.
				assert.deepStrictEqual(published(notifications), [{ uri: alphaUri, diagnostics: [] }]);
				assert.isTrue(Option.isNone(yield* registry.sessionFor(alphaPath)));

				notifications.length = 0;
				yield* Effect.promise(() => writeFile(configPath, goodConfig, "utf8"));
				yield* feature.onDocumentEvent({ kind: "open", path: alphaPath, text: alphaBroken, version: 2 });
				handle = Option.getOrThrow(yield* registry.sessionFor(alphaPath));
				yield* TestClock.adjust("20 millis");
				yield* handle.scheduler.settle;
				assert.isTrue(
					published(notifications).some(
						(p) => p.uri === alphaUri && p.diagnostics.some((d) => d.code === "broken-links"),
					),
				);
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("(e) a watched non-config file change still schedules full and publishes (positive control)", () =>
		Effect.gen(function* () {
			const { registry, feature, notifications, alphaPath } = yield* setup();
			const alphaUri = pathToUri(alphaPath);
			const alphaBroken = BROKEN_LINK(yield* Effect.promise(() => readFile(alphaPath, "utf8")));

			// Changed on disk directly, bypassing didChange/overlay entirely: only a watched-files
			// fan-out (not a document event) can be what notices this edit.
			yield* Effect.promise(() => writeFile(alphaPath, alphaBroken, "utf8"));
			// A session has to exist before a watched-files fan-out has anything to iterate.
			yield* Effect.asVoid(registry.sessionFor(alphaPath));
			yield* feature.onWatchedFiles([alphaPath]);
			const handle = Option.getOrThrow(yield* registry.sessionFor(alphaPath));
			yield* TestClock.adjust("20 millis");
			yield* handle.scheduler.settle;
			assert.isTrue(
				published(notifications).some(
					(p) => p.uri === alphaUri && p.diagnostics.some((d) => d.code === "broken-links"),
				),
			);
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);
});
