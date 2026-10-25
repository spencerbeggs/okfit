import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { OkfitConfig } from "@okfit/core";
import { Derivation, GitHistory } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Layer, Option } from "effect";
import { planSync, runSync } from "../../src/sync/run.js";

const AT = "2026-06-01T08:00:00Z";

/** A Git fake whose `show` answers HEAD with the on-disk body and counts every call. */
const fakes = (root: string, calls: { repoRoot: number; show: number; pathLog: number }) => {
	const git = Layer.succeed(Git, {
		repoRoot: () =>
			Effect.sync(() => {
				calls.repoRoot += 1;
				return root;
			}),
		show: (_cwd: string, _ref: string, path: string) =>
			Effect.gen(function* () {
				calls.show += 1;
				const fs = yield* FileSystem.FileSystem;
				return Option.some(yield* fs.readFileString(join(root, path)));
			}).pipe(Effect.provide(NodeServices.layer)),
	} as unknown as Git["Service"]);
	const history = Layer.succeed(GitHistory, {
		pathLog: (_root: string, path: string) =>
			Effect.sync(() => {
				calls.pathLog += 1;
				return [
					{
						sha: "0123456789abcdef0123456789abcdef01234567",
						path,
						authoredAt: DateTime.makeUnsafe(AT),
						committedAt: DateTime.makeUnsafe(AT),
						authorName: "Author",
						authorEmail: "author@example.com",
					},
				];
			}),
	} as unknown as GitHistory["Service"]);
	return Layer.mergeAll(git, history, NodeServices.layer);
};

const stamped = async (root: string, name: string, title: string): Promise<void> => {
	const body = `\n# ${title}\n\nBody.\n`;
	const digest = await Effect.runPromise(
		Derivation.bodyDigest(`---\ntype: Module\ntitle: ${title}\n---${body}`).pipe(Effect.provide(NodeServices.layer)),
	);
	await writeFile(
		join(root, name),
		`---\ntype: Module\ntitle: ${title}\ngenerated:\n  by: human:ada\n  at: ${AT}\nintegrity:\n  generated:\n    body: ${digest}\n---${body}`,
	);
};

describe("runSync: lazy provenance walk (issue #21)", () => {
	it.effect("walks no concept when every concept is stamped and already logged", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-run-")));
			const calls = { repoRoot: 0, show: 0, pathLog: 0 };
			try {
				yield* Effect.promise(() => stamped(root, "a.md", "A"));
				yield* Effect.promise(() => stamped(root, "b.md", "B"));
				yield* Effect.promise(() =>
					writeFile(join(root, "log.md"), "# Log\n\n## 2026-06-01\n\n* Added A\n* Added B\n"),
				);
				yield* Effect.promise(() => writeFile(join(root, "index.md"), "# Index\n"));
				const result = yield* runSync({
					bundleRoot: root,
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated", "index", "log"]),
					dryRun: true,
				}).pipe(Effect.provide(fakes(root, calls)));
				assert.deepStrictEqual([...result.generated.unchanged].sort(), ["a", "b"]);
				assert.strictEqual(calls.pathLog, 0);
				assert.strictEqual(calls.show, 0);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("walks only the stamped concept the log still wants, plus every unstamped one", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-run-")));
			const calls = { repoRoot: 0, show: 0, pathLog: 0 };
			try {
				yield* Effect.promise(() => stamped(root, "a.md", "A"));
				yield* Effect.promise(() => stamped(root, "b.md", "B"));
				yield* Effect.promise(() =>
					writeFile(join(root, "c.md"), "---\ntype: Module\ntitle: C\ngenerated:\n  by: human:ada\n---\n\n# C\n"),
				);
				yield* Effect.promise(() => writeFile(join(root, "log.md"), "# Log\n\n## 2026-06-01\n\n* Added A\n"));
				yield* Effect.promise(() => writeFile(join(root, "index.md"), "# Index\n"));
				const result = yield* runSync({
					bundleRoot: root,
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated", "index", "log"]),
					dryRun: true,
				}).pipe(Effect.provide(fakes(root, calls)));
				// b (stamped, unlogged) and c (unstamped) walk; a does not.
				assert.strictEqual(calls.pathLog, 2);
				assert.deepStrictEqual(result.generated.written, ["c"]);
				assert.deepStrictEqual(result.log.written, ["log.md"]);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("--only index makes no git call at all", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-run-")));
			const calls = { repoRoot: 0, show: 0, pathLog: 0 };
			try {
				yield* Effect.promise(() => writeFile(join(root, "c.md"), "---\ntype: Module\ntitle: C\n---\n\n# C\n"));
				yield* Effect.promise(() => writeFile(join(root, "index.md"), "# Index\n"));
				yield* runSync({
					bundleRoot: root,
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["index"]),
					dryRun: true,
				}).pipe(Effect.provide(fakes(root, calls)));
				assert.deepStrictEqual(calls, { repoRoot: 0, show: 0, pathLog: 0 });
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});

describe("runSync --staged (issue #140)", () => {
	const STAMP = DateTime.makeUnsafe("2026-09-16T10:00:00Z");
	const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
	const git = (cwd: string, args: ReadonlyArray<string>): string =>
		execFileSync("git", [...args], { cwd, env: gitEnv, encoding: "utf8" });
	const live = Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(NodeServices.layer));

	const repo = async (): Promise<string> => {
		const root = await mkdtemp(join(tmpdir(), "okfit-staged-"));
		git(root, ["init", "-q", "-b", "main"]);
		git(root, ["config", "user.name", "Ada"]);
		git(root, ["config", "user.email", "ada@example.com"]);
		git(root, ["config", "commit.gpgsign", "false"]);
		await mkdir(join(root, "okf"));
		await writeFile(join(root, "okf", "index.md"), "# Index\n");
		return root;
	};

	it.effect("stamps a staged, never-committed concept with the given instant and re-adds it", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				const file = join(root, "okf", "new.md");
				yield* Effect.promise(() =>
					writeFile(file, "---\ntype: Module\ntitle: New\ngenerated:\n  by: human:ada\n---\n\n# New\n"),
				);
				git(root, ["add", "okf/new.md"]);
				const result = yield* runSync({
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated", "index"]),
					dryRun: false,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live));
				assert.deepStrictEqual(result.generated.written, ["new"]);
				const text = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.match(text, /\n {2}at: 2026-09-16T10:00:00Z\nintegrity:\n {2}generated:\n {4}body: [0-9a-f]{16}\n/);
				// The stamped bytes are what the index holds now, not the pre-stamp bytes.
				assert.strictEqual(git(root, ["show", ":okf/new.md"]), text);
				// The index rewrite is staged too.
				assert.ok(git(root, ["diff", "--cached", "--name-only"]).includes("okf/index.md"));
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("restages a migrate-only concept: its legacy digest moves to integrity and the file is re-added", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				const file = join(root, "okf", "old.md");
				const plain = "---\ntype: Module\ntitle: Old\n---\n\n# Old\n";
				const digest = yield* Derivation.bodyDigest(plain);
				const legacy = `---\ntype: Module\ntitle: Old\ngenerated:\n  by: human:ada\n  at: 2026-09-01T00:00:00Z\n  body_sha256: ${digest}\n---\n\n# Old\n`;
				yield* Effect.promise(() => writeFile(file, legacy));
				git(root, ["add", "okf/old.md"]);
				const result = yield* runSync({
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated"]),
					dryRun: false,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live));
				assert.deepStrictEqual(result.generated.migrated, ["old"]);
				assert.deepStrictEqual(result.generated.written, []);
				const text = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.notInclude(text, "body_sha256");
				assert.strictEqual(git(root, ["show", ":okf/old.md"]), text);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("ignores an unstaged dirty concept entirely: not written, not skipped, not listed", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				yield* Effect.promise(() =>
					writeFile(
						join(root, "okf", "a.md"),
						"---\ntype: Module\ntitle: A\ngenerated:\n  by: human:ada\n---\n\n# A\n",
					),
				);
				yield* Effect.promise(() =>
					writeFile(
						join(root, "okf", "b.md"),
						"---\ntype: Module\ntitle: B\ngenerated:\n  by: human:ada\n---\n\n# B\n",
					),
				);
				git(root, ["add", "okf/a.md"]);
				const result = yield* runSync({
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated"]),
					dryRun: true,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live));
				assert.deepStrictEqual(result.generated, {
					selected: true,
					written: ["a"],
					unchanged: [],
					migrated: [],
					skipped: [],
				});
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("stages a nested sub-index at its repo path from a linked worktree's hook environment (#315)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			const tree = `${root}-wt`;
			const saved = process.env.GIT_DIR;
			try {
				git(root, ["add", "."]);
				git(root, ["commit", "-q", "-m", "init"]);
				git(root, ["worktree", "add", "-q", tree]);
				yield* Effect.promise(() => mkdir(join(tree, "okf", "decisions")));
				yield* Effect.promise(() =>
					writeFile(
						join(tree, "okf", "decisions", "choice.md"),
						"---\ntype: Decision\ntitle: Choice\ngenerated:\n  by: human:ada\n---\n\n# Choice\n",
					),
				);
				git(tree, ["add", "okf/decisions/choice.md"]);
				// A pre-commit hook in a linked worktree runs with GIT_DIR exported and
				// no GIT_WORK_TREE, so git takes the cwd of each call as the worktree.
				process.env.GIT_DIR = git(tree, ["rev-parse", "--absolute-git-dir"]).trim();
				const result = yield* runSync({
					bundleRoot: join(tree, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated", "index"]),
					dryRun: false,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live));
				if (saved === undefined) delete process.env.GIT_DIR;
				else process.env.GIT_DIR = saved;
				assert.deepStrictEqual(result.generated.written, ["decisions/choice"]);
				const staged = git(tree, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).sort();
				assert.deepStrictEqual(staged, ["okf/decisions/choice.md", "okf/decisions/index.md", "okf/index.md"]);
			} finally {
				if (saved === undefined) delete process.env.GIT_DIR;
				else process.env.GIT_DIR = saved;
				yield* Effect.promise(() => rm(tree, { recursive: true, force: true }));
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	const concept = (title: string, extra = ""): string =>
		`---\ntype: Module\ntitle: ${title}\ngenerated:\n  by: human:ada\n---\n\n# ${title}\n${extra}`;
	const ALL = new Set(["generated", "index", "log"] as const);

	it.effect("restages index and log writes at their real paths when the bundle root is reached through a symlink", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			const link = `${root}-link`;
			try {
				yield* Effect.promise(() => symlink(root, link));
				yield* Effect.promise(() => mkdir(join(root, "okf", "decisions")));
				yield* Effect.promise(() => writeFile(join(root, "okf", "decisions", "choice.md"), concept("Choice")));
				git(root, ["add", "okf/decisions/choice.md"]);
				const plan = yield* planSync({
					bundleRoot: join(link, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: ALL,
					dryRun: false,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live));
				const real = yield* Effect.promise(() => realpath(root));
				assert.deepStrictEqual(
					[...(plan.restage?.files ?? [])].sort(),
					[
						join(real, "okf", "decisions", "choice.md"),
						join(real, "okf", "decisions", "index.md"),
						join(real, "okf", "index.md"),
						join(real, "okf", "log.md"),
					].sort(),
				);
			} finally {
				yield* Effect.promise(() => rm(link, { force: true }));
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect(
		"writes and restages the commit's own log entry: Added for a new path, Updated for one in HEAD (#295)",
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(repo);
				try {
					yield* Effect.promise(() => writeFile(join(root, "okf", "old.md"), concept("Old")));
					git(root, ["add", "."]);
					git(root, ["commit", "-q", "-m", "init"]);
					yield* Effect.promise(() => writeFile(join(root, "okf", "old.md"), concept("Old", "\nMore.\n")));
					yield* Effect.promise(() => writeFile(join(root, "okf", "new.md"), concept("New")));
					git(root, ["add", "okf/old.md", "okf/new.md"]);
					const result = yield* runSync({
						bundleRoot: join(root, "okf"),
						config: OkfitConfig.DEFAULTS,
						modes: ALL,
						dryRun: false,
						staged: { at: STAMP },
					}).pipe(Effect.provide(live));
					assert.deepStrictEqual(result.log.written, ["log.md"]);
					const log = yield* Effect.promise(() => readFile(join(root, "okf", "log.md"), "utf8"));
					assert.strictEqual(log, "# Log\n\n## 2026-09-16\n\n* Added New\n* Updated Old\n");
					assert.strictEqual(git(root, ["show", ":okf/log.md"]), log);
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
	);

	it.effect("leaves the log unchanged on a re-run (an amend) and on the post-commit sync (#295)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				yield* Effect.promise(() => writeFile(join(root, "okf", "new.md"), concept("New")));
				git(root, ["add", "."]);
				const options = {
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: ALL,
					dryRun: false,
					staged: { at: STAMP },
				};
				yield* runSync(options).pipe(Effect.provide(live));
				const again = yield* runSync(options).pipe(Effect.provide(live));
				assert.deepStrictEqual(again.log.unchanged, ["log.md"]);
				execFileSync("git", ["commit", "-q", "-m", "add new"], {
					cwd: root,
					env: { ...gitEnv, GIT_AUTHOR_DATE: "2026-09-16T10:00:00Z", GIT_COMMITTER_DATE: "2026-09-16T10:00:00Z" },
				});
				const { staged: _, ...plain } = options;
				const after = yield* runSync({ ...plain, dryRun: true }).pipe(Effect.provide(live));
				assert.deepStrictEqual(after.log.written, []);
				assert.deepStrictEqual(after.generated.written, []);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("skips a log.md with unstaged edits as dirty rather than staging them (#295)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				yield* Effect.promise(() => writeFile(join(root, "okf", "log.md"), "# Log\n"));
				git(root, ["add", "."]);
				git(root, ["commit", "-q", "-m", "init"]);
				yield* Effect.promise(() => writeFile(join(root, "okf", "log.md"), "# Log\n\nHand-written, unstaged.\n"));
				yield* Effect.promise(() => writeFile(join(root, "okf", "new.md"), concept("New")));
				git(root, ["add", "okf/new.md"]);
				const result = yield* runSync({
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: ALL,
					dryRun: false,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live));
				assert.deepStrictEqual(result.log.skipped, [{ id: "log.md", reason: "dirty" }]);
				assert.deepStrictEqual(result.log.written, []);
				assert.notInclude(git(root, ["diff", "--cached", "--name-only"]), "okf/log.md");
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});
