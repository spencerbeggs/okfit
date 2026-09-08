import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { walk } from "../src/internal/walk.js";
import { faultyPlatform, platform } from "./utils/bundles.js";

const seed = {
	"/b/index.md": "",
	"/b/a/x.md": "",
	"/b/a/y.txt": "",
	"/b/.drafts/h.md": "",
	"/b/.dot.md": "",
	"/b/node_modules/pkg/i.md": "",
	"/b/deep/1/2/3.md": "",
	"/b/link": MemoryFileSystem.symlink("/b/a"),
	"/b/flink.md": MemoryFileSystem.symlink("/b/a/x.md"),
};
const defaults = { root: "/b", includeHidden: false, maxDepth: 256, prune: new Set(["node_modules", ".git"]) };

describe("internal/walk", () => {
	it.effect("lists every file posix-relative and sorted; hidden, pruned and symlinked dirs skipped; depth capped", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* walk(defaults)).files, [
				"a/x.md",
				"a/y.txt",
				"deep/1/2/3.md",
				"flink.md",
				"index.md",
			]);
			assert.deepStrictEqual((yield* walk({ ...defaults, includeHidden: true })).files, [
				".dot.md",
				".drafts/h.md",
				"a/x.md",
				"a/y.txt",
				"deep/1/2/3.md",
				"flink.md",
				"index.md",
			]);
			assert.deepStrictEqual((yield* walk({ ...defaults, maxDepth: 3 })).files, [
				"a/x.md",
				"a/y.txt",
				"deep/1/2/3.md",
				"flink.md",
				"index.md",
			]);
			const failure = yield* Effect.flip(walk({ ...defaults, maxDepth: 1 }));
			if (failure._tag !== "DescendError") return assert.fail("expected a DescendError");
			assert.strictEqual(failure.reason, "depthExceeded");
			assert.strictEqual(failure.path, "deep");
			assert.strictEqual(failure.limit, 1);
		}).pipe(Effect.provide(platform(seed))),
	);
	it.effect("a file symlink is listed as a file; a directory symlink is never descended", () =>
		Effect.gen(function* () {
			const result = yield* walk(defaults);
			assert.include(result.files, "flink.md");
			assert.isFalse(result.files.some((file) => file.startsWith("link/")));
		}).pipe(Effect.provide(platform(seed))),
	);
	it.effect("an unreadable subdirectory is reported, not fatal", () =>
		Effect.gen(function* () {
			const result = yield* walk(defaults);
			assert.deepStrictEqual(result.unreadable, ["locked"]);
			assert.isFalse(result.files.some((file) => file.startsWith("locked/")));
		}).pipe(Effect.provide(faultyPlatform({ ...seed, "/b/locked/z.md": "" }, new Set(["/b/locked"])))),
	);
	it.effect("two unreadable subdirectories come back sorted, not in walk order", () =>
		Effect.gen(function* () {
			const result = yield* walk(defaults);
			assert.deepStrictEqual(result.unreadable, ["a/inner", "locked"]);
		}).pipe(
			Effect.provide(
				faultyPlatform({ ...seed, "/b/locked/z.md": "", "/b/a/inner/w.md": "" }, new Set(["/b/locked", "/b/a/inner"])),
			),
		),
	);
	it.effect("an unreadable root fails with the PlatformError", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(walk(defaults));
			if (failure._tag !== "PlatformError") return assert.fail("expected a PlatformError");
			assert.strictEqual(failure.reason._tag, "PermissionDenied");
		}).pipe(Effect.provide(faultyPlatform(seed, new Set(["/b"])))),
	);
});
