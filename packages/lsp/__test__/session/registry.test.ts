import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Logger, Option } from "effect";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { copyFixtureProject } from "../utils/fixture.js";
import { testPlatform } from "../utils/platform.js";

interface CapturedLog {
	readonly level: string;
	readonly message: ReadonlyArray<unknown>;
}

const platform = testPlatform();
const BROKEN_CONFIG = "[lint\nbroken = ";
const OTHER_BROKEN_CONFIG = "[lint]\nstatus_missing = 42\n";
const FIXED_CONFIG = '[lint]\ngenerated_at_drift = "off"\n';
const make = () =>
	makeSessionRegistry({
		delay: "10 millis",
		maxWait: "10 seconds",
		onRevalidate: () => Effect.void,
		onDispose: () => Effect.void,
	});

describe("SessionRegistry", () => {
	it.effect("a document under the folder's bundle root gets a session whose root is the bundle root", () =>
		Effect.gen(function* () {
			const { root } = yield* copyFixtureProject();
			const registry = yield* make();
			yield* registry.setFolders([root]);
			const handle = yield* registry.sessionFor(join(root, "okf", "modules", "alpha.md"));
			assert.isTrue(Option.isSome(handle));
			assert.strictEqual(Option.getOrThrow(handle).bundleRoot, join(root, "okf"));
			assert.strictEqual(Option.getOrThrow(handle).session.root, join(root, "okf"));
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"a document in the folder but outside the bundle root gets none; a document under it gets some (control)",
		() =>
			Effect.gen(function* () {
				const { root } = yield* copyFixtureProject();
				const registry = yield* make();
				yield* registry.setFolders([root]);
				assert.isTrue(Option.isNone(yield* registry.sessionFor(join(root, "README.md"))));
				assert.isTrue(Option.isSome(yield* registry.sessionFor(join(root, "okf", "index.md"))));
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("a document outside every folder gets none, and adding its folder later makes it some", () =>
		Effect.gen(function* () {
			const { root } = yield* copyFixtureProject();
			const registry = yield* make();
			const file = join(root, "okf", "modules", "alpha.md");
			assert.isTrue(Option.isNone(yield* registry.sessionFor(file)));
			yield* registry.addFolders([root]);
			assert.isTrue(Option.isSome(yield* registry.sessionFor(file)));
			yield* registry.removeFolders([root]);
			assert.isTrue(Option.isNone(yield* registry.sessionFor(file)));
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("the same folder yields the same session object across calls", () =>
		Effect.gen(function* () {
			const { root } = yield* copyFixtureProject();
			const registry = yield* make();
			yield* registry.setFolders([root]);
			const a = Option.getOrThrow(yield* registry.sessionFor(join(root, "okf", "modules", "alpha.md")));
			const b = Option.getOrThrow(yield* registry.sessionFor(join(root, "okf", "modules", "beta.md")));
			assert.strictEqual(a.session, b.session);
			assert.strictEqual((yield* registry.sessions).length, 1);
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"a folder whose config is malformed yields none; once fixed, a plain lookup still answers from the cached failure and a retrying lookup recovers",
		() =>
			Effect.gen(function* () {
				const { root } = yield* copyFixtureProject();
				yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), BROKEN_CONFIG, "utf8"));
				const registry = yield* make();
				yield* registry.setFolders([root]);
				const file = join(root, "okf", "modules", "alpha.md");
				assert.isTrue(Option.isNone(yield* registry.sessionFor(file)));
				assert.isTrue(Option.isNone(yield* registry.sessionFor(file, { retryFailed: true })));
				yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), FIXED_CONFIG, "utf8"));
				assert.isTrue(Option.isNone(yield* registry.sessionFor(file)));
				assert.isTrue(Option.isSome(yield* registry.sessionFor(file, { retryFailed: true })));
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"rebuilding a live root into a config that fails to load caches the failure; once fixed, a retrying lookup recovers",
		() =>
			Effect.gen(function* () {
				const { root } = yield* copyFixtureProject();
				const registry = yield* make();
				yield* registry.setFolders([root]);
				const file = join(root, "okf", "modules", "alpha.md");
				assert.isTrue(Option.isSome(yield* registry.sessionFor(file)));
				yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), BROKEN_CONFIG, "utf8"));
				assert.deepStrictEqual(yield* registry.rebuild(join(root, "okf")), []);
				assert.isTrue(Option.isNone(yield* registry.sessionFor(file)));
				assert.strictEqual((yield* registry.sessions).length, 0);
				yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), FIXED_CONFIG, "utf8"));
				assert.isTrue(Option.isSome(yield* registry.sessionFor(file, { retryFailed: true })));
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("rebuild disposes the old handle through onDispose and returns the fresh one", () =>
		Effect.gen(function* () {
			const { root } = yield* copyFixtureProject();
			const disposed: Array<string> = [];
			const registry = yield* makeSessionRegistry({
				delay: "10 millis",
				maxWait: "10 seconds",
				onRevalidate: () => Effect.void,
				onDispose: (oldHandle) => Effect.sync(() => void disposed.push(oldHandle.bundleRoot)),
			});
			yield* registry.setFolders([root]);
			const file = join(root, "okf", "modules", "alpha.md");
			const before = Option.getOrThrow(yield* registry.sessionFor(file));
			const rebuilt = yield* registry.rebuild(before.bundleRoot);
			assert.deepStrictEqual(disposed, [join(root, "okf")]);
			assert.strictEqual(rebuilt.length, 1);
			assert.notStrictEqual(rebuilt[0]?.session, before.session);
			assert.strictEqual(Option.getOrThrow(yield* registry.sessionFor(file)).session, rebuilt[0]?.session);
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"rebuild of a root with no live session returns [] and runs onDispose zero times (control for the dispose case above)",
		() =>
			Effect.gen(function* () {
				const { root } = yield* copyFixtureProject();
				const disposed: Array<string> = [];
				const registry = yield* makeSessionRegistry({
					delay: "10 millis",
					maxWait: "10 seconds",
					onRevalidate: () => Effect.void,
					onDispose: (oldHandle) => Effect.sync(() => void disposed.push(oldHandle.bundleRoot)),
				});
				yield* registry.setFolders([root]);
				assert.deepStrictEqual(yield* registry.rebuild(join(root, "okf")), []);
				assert.deepStrictEqual(disposed, []);
				assert.strictEqual((yield* registry.sessions).length, 0);
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"(c) two folders resolving to one bundle root share one session, listed once; removing one folder keeps it, removing the last disposes it once",
		() =>
			Effect.gen(function* () {
				const { root } = yield* copyFixtureProject();
				const bundleRoot = join(root, "okf");
				const disposed: Array<string> = [];
				const registry = yield* makeSessionRegistry({
					delay: "10 millis",
					maxWait: "10 seconds",
					onRevalidate: () => Effect.void,
					onDispose: (oldHandle) => Effect.sync(() => void disposed.push(oldHandle.bundleRoot)),
				});
				yield* registry.setFolders([root, bundleRoot]);
				// README.md is owned by the outer folder and outside the bundle: none, but it resolves that folder.
				assert.isTrue(Option.isNone(yield* registry.sessionFor(join(root, "README.md"))));
				const inner = Option.getOrThrow(yield* registry.sessionFor(join(bundleRoot, "modules", "alpha.md")));
				// Both folders are now resolved; one session serves the shared root.
				assert.strictEqual((yield* registry.sessions).length, 1);

				yield* registry.removeFolders([root]);
				assert.deepStrictEqual(disposed, []);
				assert.strictEqual(
					Option.getOrThrow(yield* registry.sessionFor(join(bundleRoot, "modules", "alpha.md"))).session,
					inner.session,
				);

				yield* registry.removeFolders([bundleRoot]);
				assert.deepStrictEqual(disposed, [bundleRoot]);
				assert.strictEqual((yield* registry.sessions).length, 0);
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"retryFailed rebuilds a failed folder containing a changed path and returns it; a path outside it rebuilds nothing",
		() =>
			Effect.gen(function* () {
				const { root } = yield* copyFixtureProject();
				yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), BROKEN_CONFIG, "utf8"));
				const registry = yield* make();
				yield* registry.setFolders([root]);
				assert.isTrue(Option.isNone(yield* registry.sessionFor(join(root, "okf", "modules", "alpha.md"))));
				yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), FIXED_CONFIG, "utf8"));
				assert.deepStrictEqual(yield* registry.retryFailed([join(root, "..", "elsewhere", ".okfit.toml")]), []);
				assert.strictEqual((yield* registry.sessions).length, 0);
				const recovered = yield* registry.retryFailed([join(root, ".okfit.toml")]);
				assert.strictEqual(recovered.length, 1);
				assert.strictEqual(recovered[0].folder, root);
				assert.strictEqual((yield* registry.sessions).length, 1);
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("the longest matching folder owns a nested document", () =>
		Effect.gen(function* () {
			const outer = yield* copyFixtureProject();
			const inner = yield* copyFixtureProject();
			// inner is not under outer on disk; simulate nesting by registering outer's parent and outer itself.
			const registry = yield* make();
			yield* registry.setFolders([join(outer.root, ".."), outer.root]);
			const handle = Option.getOrThrow(yield* registry.sessionFor(join(outer.root, "okf", "modules", "alpha.md")));
			assert.strictEqual(handle.folder, outer.root);
			void inner;
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("a malformed folder's config error is logged exactly once across repeated lookups and retries", () => {
		const entries: Array<CapturedLog> = [];
		const capturingLogger = Logger.make<unknown, void>((options) => {
			entries.push({ level: options.logLevel, message: options.message as ReadonlyArray<unknown> });
		});

		return Effect.gen(function* () {
			const { root } = yield* copyFixtureProject();
			yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), BROKEN_CONFIG, "utf8"));

			const registry = yield* make();
			yield* registry.setFolders([root]);
			const file = join(root, "okf", "modules", "alpha.md");
			yield* registry.sessionFor(file);
			yield* registry.sessionFor(file);
			yield* registry.sessionFor(file, { retryFailed: true });
			yield* registry.retryFailed([join(root, ".okfit.toml")]);

			const warnings = entries.filter(
				(entry) => entry.level === "Warn" && entry.message.some((part) => String(part).includes(root)),
			);
			assert.strictEqual(warnings.length, 1);
		}).pipe(Effect.scoped, Effect.provide(platform), Effect.provide(Logger.layer([capturingLogger])));
	});

	it.effect("a retry that fails with a different error logs again (control for logged-once)", () => {
		const entries: Array<CapturedLog> = [];
		const capturingLogger = Logger.make<unknown, void>((options) => {
			entries.push({ level: options.logLevel, message: options.message as ReadonlyArray<unknown> });
		});

		return Effect.gen(function* () {
			const { root } = yield* copyFixtureProject();
			yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), BROKEN_CONFIG, "utf8"));
			const registry = yield* make();
			yield* registry.setFolders([root]);
			const file = join(root, "okf", "modules", "alpha.md");
			yield* registry.sessionFor(file);
			yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), OTHER_BROKEN_CONFIG, "utf8"));
			yield* registry.sessionFor(file, { retryFailed: true });

			const warnings = entries.filter(
				(entry) => entry.level === "Warn" && entry.message.some((part) => String(part).includes(root)),
			);
			assert.strictEqual(warnings.length, 2);
		}).pipe(Effect.scoped, Effect.provide(platform), Effect.provide(Logger.layer([capturingLogger])));
	});

	it.effect("folders reports the workspace folder set in insertion order; removeFolders drops from it", () =>
		Effect.gen(function* () {
			const a = yield* copyFixtureProject();
			const b = yield* copyFixtureProject();
			const registry = yield* make();
			assert.deepStrictEqual(yield* registry.folders, []);
			yield* registry.setFolders([a.root, b.root]);
			assert.deepStrictEqual(yield* registry.folders, [a.root, b.root]);
			yield* registry.removeFolders([a.root]);
			assert.deepStrictEqual(yield* registry.folders, [b.root]);
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);
});
