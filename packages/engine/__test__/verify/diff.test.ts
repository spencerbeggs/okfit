import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { DateTime, Effect, Layer } from "effect";
import { changeSince } from "../../src/verify/diff.js";

const platform = Layer.mergeAll(Git.layer, NodeServices.layer).pipe(Layer.provide(NodeServices.layer));
const layer = Layer.mergeAll(platform, NodeServices.layer);

const GIT_ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	LC_ALL: "C",
};

const git = (cwd: string, args: ReadonlyArray<string>, date?: string): void => {
	execFileSync("git", [...args], {
		cwd,
		env: date === undefined ? GIT_ENV : { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
		stdio: "pipe",
	});
};

const withDir = <A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "okfit-diff-")))),
		body,
		(dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
	);

const initRepo = (dir: string) => {
	git(dir, ["-c", "init.defaultBranch=main", "init", "-q"]);
	git(dir, ["config", "user.name", "Ada"]);
	git(dir, ["config", "user.email", "ada@example.com"]);
	git(dir, ["config", "commit.gpgsign", "false"]);
};

const commit = (dir: string, message: string, date: string) => {
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-q", "-m", message], date);
};

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
