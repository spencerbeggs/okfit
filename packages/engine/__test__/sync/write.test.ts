import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { writeAtomic } from "../../src/sync/write.js";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("writeAtomic", () => {
	it.effect("a failed rename leaves no temp file behind and fails the effect", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-write-atomic-")));
			try {
				// A DIRECTORY where `rename`'s destination is expected: renaming a
				// file onto an existing directory fails with EISDIR on every
				// platform and every uid (unlike a chmod-000 directory, which a
				// root-owned CI container ignores -- @okfit/engine's config/layer.test.ts's own
				// note), so this is a deterministic way to force `writeAtomic`'s
				// `rename` step to fail without relying on filesystem permissions.
				const target = join(root, "log.md");
				yield* Effect.promise(() => mkdir(target));

				const result = yield* writeAtomic(target, "replacement\n").pipe(Effect.result);
				assert.strictEqual(result._tag, "Failure");

				// No `log.md.okfit-sync.<token>.tmp` (or any stray sync temp file)
				// survives the failed rename (F-5/S-33).
				const entries = yield* Effect.promise(() => readdir(root));
				assert.deepStrictEqual(
					entries.filter((entry) => entry.includes(".okfit-sync.")),
					[],
				);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a successful write replaces the target and leaves no temp file", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-write-atomic-")));
			try {
				const target = join(root, "log.md");
				yield* writeAtomic(target, "original\n");
				assert.strictEqual(yield* Effect.promise(() => readFile(target, "utf8")), "original\n");

				yield* writeAtomic(target, "replacement\n");
				assert.strictEqual(yield* Effect.promise(() => readFile(target, "utf8")), "replacement\n");

				const entries = yield* Effect.promise(() => readdir(root));
				assert.deepStrictEqual(entries, ["log.md"]);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("writes a brand-new file that did not exist on disk", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-write-atomic-")));
			try {
				const target = join(root, "index.md");
				yield* writeAtomic(target, "# Index\n");
				assert.strictEqual(yield* Effect.promise(() => readFile(target, "utf8")), "# Index\n");

				const entries = yield* Effect.promise(() => readdir(root));
				assert.deepStrictEqual(entries, ["index.md"]);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);
});
