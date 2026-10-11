import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { DateTime, Effect, Layer } from "effect";
import { changeSince } from "../../src/verify/diff.js";
import { commit, initRepo, withDir as withTempDir } from "../utils/git.js";

const withDir = <A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) => withTempDir("okfit-diff-", body);

const platform = Layer.mergeAll(Git.layer, NodeServices.layer).pipe(Layer.provide(NodeServices.layer));
const layer = Layer.mergeAll(platform, NodeServices.layer);

describe("changeSince", () => {
	it.effect("diffs the newest commit at or before `at` against the working tree", () =>
		withDir((dir) =>
			Effect.gen(function* () {
				initRepo(dir);
				const file = join(dir, "c.md");
				yield* Effect.promise(() => writeFile(file, "one\n"));
				commit(dir, "first", "2026-09-01T00:00:00Z");
				yield* Effect.promise(() => writeFile(file, "one\ntwo\n"));
				commit(dir, "second", "2026-09-10T00:00:00Z");
				// An uncommitted edit after the baseline.
				yield* Effect.promise(() => writeFile(file, "one\ntwo\nthree\n"));
				// Bound between the first and second commit: the baseline is the first.
				const result = yield* changeSince({ file, at: DateTime.makeUnsafe("2026-09-05T00:00:00Z") });
				assert.strictEqual(result._tag, "diff");
				if (result._tag !== "diff") return;
				assert.match(result.baseline, /^[0-9a-f]{7}$/);
				assert.include(result.patch, "+two");
				assert.include(result.patch, "+three");
				assert.notInclude(result.patch, "-one");
				// Bound exactly at the second commit's date: at-or-before includes it.
				const later = yield* changeSince({ file, at: DateTime.makeUnsafe("2026-09-10T00:00:00Z") });
				assert.strictEqual(later._tag, "diff");
				if (later._tag !== "diff") return;
				assert.notInclude(later.patch, "+two");
				assert.include(later.patch, "+three");
				assert.notStrictEqual(later.baseline, result.baseline);
			}).pipe(Effect.provide(layer)),
		),
	);

	it.effect("no commit at or before `at` is no-commit-before", () =>
		withDir((dir) =>
			Effect.gen(function* () {
				initRepo(dir);
				const file = join(dir, "c.md");
				yield* Effect.promise(() => writeFile(file, "one\n"));
				commit(dir, "first", "2026-09-10T00:00:00Z");
				const result = yield* changeSince({ file, at: DateTime.makeUnsafe("2026-09-01T00:00:00Z") });
				assert.deepStrictEqual(result, { _tag: "no-baseline", reason: "no-commit-before" });
			}).pipe(Effect.provide(layer)),
		),
	);

	it.effect("an untracked file in a repository has no commit before", () =>
		withDir((dir) =>
			Effect.gen(function* () {
				initRepo(dir);
				const file = join(dir, "c.md");
				yield* Effect.promise(() => writeFile(file, "one\n"));
				const result = yield* changeSince({ file, at: DateTime.makeUnsafe("2026-09-01T00:00:00Z") });
				assert.deepStrictEqual(result, { _tag: "no-baseline", reason: "no-commit-before" });
			}).pipe(Effect.provide(layer)),
		),
	);

	it.effect("a file outside a repository is not-a-repository", () =>
		withDir((dir) =>
			Effect.gen(function* () {
				const file = join(dir, "c.md");
				yield* Effect.promise(() => writeFile(file, "one\n"));
				const result = yield* changeSince({ file, at: DateTime.makeUnsafe("2026-09-01T00:00:00Z") });
				assert.deepStrictEqual(result, { _tag: "no-baseline", reason: "not-a-repository" });
			}).pipe(Effect.provide(layer)),
		),
	);
});
