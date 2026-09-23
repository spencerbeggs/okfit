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
const make = () => makeSessionRegistry({ delay: "10 millis", onRevalidate: () => Effect.void });

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

	it.effect("a folder whose config is malformed yields none, is logged once, and recovers after invalidate", () =>
		Effect.gen(function* () {
			const { root } = yield* copyFixtureProject();
			yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), "[lint\nbroken = ", "utf8"));
			const registry = yield* make();
			yield* registry.setFolders([root]);
			const file = join(root, "okf", "modules", "alpha.md");
			assert.isTrue(Option.isNone(yield* registry.sessionFor(file)));
			assert.isTrue(Option.isNone(yield* registry.sessionFor(file)));
			yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), '[lint]\ngenerated_at_drift = "off"\n', "utf8"));
			assert.isTrue(Option.isNone(yield* registry.sessionFor(file)));
			yield* registry.invalidate(root);
			assert.isTrue(Option.isSome(yield* registry.sessionFor(file)));
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

	it.effect("a malformed folder's config error is logged exactly once across repeated lookups", () => {
		const entries: Array<CapturedLog> = [];
		const capturingLogger = Logger.make<unknown, void>((options) => {
			entries.push({ level: options.logLevel, message: options.message as ReadonlyArray<unknown> });
		});

		return Effect.gen(function* () {
			const { root } = yield* copyFixtureProject();
			yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), "[lint\nbroken = ", "utf8"));

			const registry = yield* make();
			yield* registry.setFolders([root]);
			const file = join(root, "okf", "modules", "alpha.md");
			yield* registry.sessionFor(file);
			yield* registry.sessionFor(file);

			const warnings = entries.filter(
				(entry) => entry.level === "Warn" && entry.message.some((part) => String(part).includes(root)),
			);
			assert.strictEqual(warnings.length, 1);
		}).pipe(Effect.scoped, Effect.provide(platform), Effect.provide(Logger.layer([capturingLogger])));
	});
});
