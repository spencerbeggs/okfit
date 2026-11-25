import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { OkfitConfig } from "@okfit/core";
import { Derivation, GitHistory } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Layer, Option } from "effect";
import { planSync, runSync } from "../../src/sync/run.js";
import { TestPlatform } from "../utils/platform.js";

const AT = "2026-06-01T08:00:00Z";

/** A Git fake whose `show` answers HEAD with the on-disk body and counts every call. */
const fakes = (root: string, calls: { repoRoot: number; show: number; pathLog: number }) => {
	const git = Git.layerTest({
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
			}).pipe(Effect.provide(TestPlatform), Effect.orDie),
	});
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
	return Layer.mergeAll(git, history, TestPlatform);
};

const stamped = async (root: string, name: string, title: string): Promise<void> => {
	const body = `\n# ${title}\n\nBody.\n`;
	const digest = await Effect.runPromise(
		Derivation.bodyDigest(`---\ntype: Module\ntitle: ${title}\n---${body}`).pipe(Effect.provide(TestPlatform)),
	);
	await writeFile(
		join(root, name),
		`---\ntype: Module\ntitle: ${title}\ngenerated:\n  by: human:ada\n  at: ${AT}\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n---${body}`,
	);
};

const legacyConcept = async (root: string, name: string, title: string): Promise<string> => {
	const body = `\n# ${title}\n\nBody.\n`;
	const digest = await Effect.runPromise(
		Derivation.bodyDigest(`---\ntype: Module\ntitle: ${title}\n---${body}`).pipe(Effect.provide(TestPlatform)),
	);
	const text = `---\ntype: Module\ntitle: ${title}\ngenerated:\n  by: human:ada\n  at: ${AT}\nintegrity:\n  generated:\n    body: ${digest}\n---${body}`;
	await writeFile(join(root, name), text);
	return text;
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

	it.effect("--dry-run lists the legacy-key migration it would write and writes nothing", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-run-")));
			const calls = { repoRoot: 0, show: 0, pathLog: 0 };
			try {
				const before = yield* Effect.promise(() => legacyConcept(root, "a.md", "A"));
				yield* Effect.promise(() => legacyConcept(root, "b.md", "B"));
				const result = yield* runSync({
					bundleRoot: root,
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated"]),
					dryRun: true,
				}).pipe(Effect.provide(fakes(root, calls)));
				assert.deepStrictEqual([...result.generated.migrated].sort(), ["a", "b"]);
				assert.deepStrictEqual(result.generated.written, []);
				assert.strictEqual(calls.pathLog, 0);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "a.md"), "utf8")), before);
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
	const live = Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(TestPlatform));

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
				assert.match(
					text,
					/\n {2}at: 2026-09-16T10:00:00Z\nx-okfit-integrity:\n {2}generated:\n {4}body: [0-9a-f]{16}\n/,
				);
				// The stamped bytes are what the index holds now, not the pre-stamp bytes.
				assert.strictEqual(git(root, ["show", ":okf/new.md"]), text);
				// The index rewrite is staged too.
				assert.ok(git(root, ["diff", "--cached", "--name-only"]).includes("okf/index.md"));
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("stamps the verification instant, not the hook's, over a staged edit-then-verify file (R30)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				const frontmatter = (content: string) =>
					`---\ntype: Module\ntitle: New\ngenerated:\n  by: human:ada\n  at: 2026-01-01T00:00:00Z\nverified:\n  - by: human:ada\n    at: 2026-09-16T09:00:00Z\nx-okfit-integrity:\n  verified:\n    by: human:ada\n    at: 2026-09-16T09:00:00Z\n    content: ${content}\n---\n\n# New\n`;
				const placeholder = frontmatter("0000000000000000");
				const content = yield* Derivation.contentDigest({ type: "Module", title: "New" }, placeholder);
				const file = join(root, "okf", "new.md");
				yield* Effect.promise(() => writeFile(file, frontmatter(content)));
				git(root, ["add", "okf/new.md"]);
				const result = yield* runSync({
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated"]),
					dryRun: false,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live));
				assert.deepStrictEqual(result.generated.written, ["new"]);
				const text = yield* Effect.promise(() => readFile(file, "utf8"));
				// the hook's STAMP is 10:00:00; the binding is 09:00:00 over this exact content
				assert.match(text, /generated:\n {2}by: human:ada\n {2}at: 2026-09-16T09:00:00Z\n/);
				assert.notInclude(text, "2026-09-16T10:00:00Z");
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("never loads, stamps or rewrites a file symlinked outside the bundle (OKF 0.3 §3.2)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			const outside = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-outside-")));
			try {
				const target = join(outside, "elsewhere.md");
				const original = "---\ntype: Module\ntitle: Else\n---\n\n# Else\n";
				yield* Effect.promise(() => writeFile(target, original));
				yield* Effect.promise(() => symlink(target, join(root, "okf", "else.md")));
				// Positive control: a real staged concept beside it is stamped.
				yield* Effect.promise(() =>
					writeFile(
						join(root, "okf", "new.md"),
						"---\ntype: Module\ntitle: New\ngenerated:\n  by: human:ada\n---\n\n# New\n",
					),
				);
				git(root, ["add", "okf/new.md"]);
				const result = yield* runSync({
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated"]),
					dryRun: false,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live));
				assert.deepStrictEqual(result.generated.written, ["new"]);
				assert.strictEqual(yield* Effect.promise(() => readFile(target, "utf8")), original);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				yield* Effect.promise(() => rm(outside, { recursive: true, force: true }));
			}
		}),
	);

	it.effect(
		"skips a log.md that is a symlink out of the repository rather than failing (#351, OKF 0.3 section 3.2)",
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(repo);
				const outside = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-outside-")));
				try {
					const target = join(outside, "log.md");
					yield* Effect.promise(() => writeFile(target, "# Log\n"));
					yield* Effect.promise(() => symlink(target, join(root, "okf", "log.md")));
					const result = yield* runSync({
						bundleRoot: join(root, "okf"),
						config: OkfitConfig.DEFAULTS,
						modes: new Set(["log"]),
						dryRun: false,
						staged: { at: STAMP },
					}).pipe(Effect.provide(live));
					assert.deepStrictEqual(result.log.skipped, [{ id: "log.md", reason: "symlink-escape" }]);
					assert.deepStrictEqual(result.log.written, []);
					assert.strictEqual(yield* Effect.promise(() => readFile(target, "utf8")), "# Log\n");
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
					yield* Effect.promise(() => rm(outside, { recursive: true, force: true }));
				}
			}),
	);

	for (const kind of ["escaping", "dangling"] as const) {
		for (const dryRun of [false, true]) {
			it.effect(`skips ${kind} reserved files, still syncs a plain sibling, and exits cleanly (dryRun ${dryRun})`, () =>
				Effect.gen(function* () {
					const root = yield* Effect.promise(repo);
					const outside = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-outside-")));
					try {
						const concept = (title: string): string =>
							`---\ntype: Module\ntitle: ${title}\ngenerated:\n  by: human:ada\n---\n\n# ${title}\n`;
						const names = { index: "index.md", sub: "sub-index.md", log: "log.md" } as const;
						if (kind === "escaping") {
							for (const name of Object.values(names)) {
								yield* Effect.promise(() => writeFile(join(outside, name), `# Outside ${name}\n`));
							}
						}
						const link = async (target: string, at: string): Promise<void> => {
							await rm(at, { force: true });
							await symlink(join(outside, target), at);
						};
						yield* Effect.promise(() => mkdir(join(root, "okf", "linked")));
						yield* Effect.promise(() => mkdir(join(root, "okf", "plain")));
						yield* Effect.promise(() => link(names.index, join(root, "okf", "index.md")));
						yield* Effect.promise(() => link(names.sub, join(root, "okf", "linked", "index.md")));
						yield* Effect.promise(() => link(names.log, join(root, "okf", "log.md")));
						yield* Effect.promise(() => writeFile(join(root, "okf", "linked", "a.md"), concept("A")));
						yield* Effect.promise(() => writeFile(join(root, "okf", "plain", "b.md"), concept("B")));
						git(root, ["add", "okf/linked/a.md", "okf/plain/b.md"]);
						const result = yield* runSync({
							bundleRoot: join(root, "okf"),
							config: OkfitConfig.DEFAULTS,
							modes: new Set(["index", "log"]),
							dryRun,
							staged: { at: STAMP },
						}).pipe(Effect.provide(live));
						assert.deepStrictEqual(
							[...result.index.skipped].sort((x, y) => x.id.localeCompare(y.id)),
							[
								{ id: "index.md", reason: "symlink-escape" },
								{ id: "linked/index.md", reason: "symlink-escape" },
							],
						);
						assert.deepStrictEqual(result.log.skipped, [{ id: "log.md", reason: "symlink-escape" }]);
						assert.deepStrictEqual(result.log.written, []);
						// Control: the plain sibling's index is written (planned under a dry run).
						assert.deepStrictEqual(result.index.written, ["plain/index.md"]);
						const plain = join(root, "okf", "plain", "index.md");
						const exists = yield* Effect.promise(() =>
							readFile(plain, "utf8").then(
								() => true,
								() => false,
							),
						);
						assert.strictEqual(exists, !dryRun);
						for (const name of Object.values(names)) {
							const text = yield* Effect.promise(() =>
								readFile(join(outside, name), "utf8").then(
									(value) => value,
									() => undefined,
								),
							);
							assert.strictEqual(text, kind === "escaping" ? `# Outside ${name}\n` : undefined);
						}
					} finally {
						yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
						yield* Effect.promise(() => rm(outside, { recursive: true, force: true }));
					}
				}),
			);
		}
	}

	it.effect("a staged run migrates only the staged legacy concept", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				yield* Effect.promise(() => legacyConcept(join(root, "okf"), "one.md", "One"));
				const two = yield* Effect.promise(() => legacyConcept(join(root, "okf"), "two.md", "Two"));
				git(root, ["add", "okf/one.md"]);
				const result = yield* runSync({
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated"]),
					dryRun: false,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live));
				assert.deepStrictEqual(result.generated.migrated, ["one"]);
				assert.include(
					yield* Effect.promise(() => readFile(join(root, "okf", "one.md"), "utf8")),
					"\nx-okfit-integrity:",
				);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "okf", "two.md"), "utf8")), two);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("a dirty legacy concept: dry-run lists it migrated and skipped, the real run renames only the key", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				const file = join(root, "okf", "dirty.md");
				const legacy = yield* Effect.promise(() => legacyConcept(join(root, "okf"), "dirty.md", "Dirty"));
				git(root, ["add", "-A"]);
				git(root, ["commit", "-q", "-m", "seed"]);
				const edited = `${legacy}\nAn uncommitted edit.\n`;
				yield* Effect.promise(() => writeFile(file, edited));
				const options = {
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated" as const]),
				};
				const dry = yield* runSync({ ...options, dryRun: true }).pipe(Effect.provide(live));
				assert.deepStrictEqual(dry.generated.migrated, ["dirty"]);
				assert.deepStrictEqual(dry.generated.written, []);
				assert.deepStrictEqual(dry.generated.skipped, [{ id: "dirty", reason: "dirty" }]);
				assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), edited);
				yield* runSync({ ...options, dryRun: false }).pipe(Effect.provide(live));
				assert.strictEqual(
					yield* Effect.promise(() => readFile(file, "utf8")),
					edited.replace("\nintegrity:", "\nx-okfit-integrity:"),
				);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(TestPlatform)),
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
		}).pipe(Effect.provide(TestPlatform)),
	);

	describe("index mode lists the git index, not the working tree (#142)", () => {
		const concept = (title: string, description?: string): string =>
			`---\ntype: Module\ntitle: ${title}\n${description === undefined ? "" : `description: ${description}\n`}generated:\n  by: human:ada\n---\n\n# ${title}\n`;
		const plan = (root: string, staged: boolean) =>
			planSync({
				bundleRoot: join(root, "okf"),
				config: OkfitConfig.DEFAULTS,
				modes: new Set(["index"]),
				dryRun: true,
				...(staged ? { staged: { at: STAMP } } : {}),
			}).pipe(Effect.provide(live));
		const rootIndex = (planned: { pending: ReadonlyArray<{ target: string; contents: string }> }) =>
			planned.pending.find((write) => write.target.endsWith(join("okf", "index.md")))?.contents ?? "";
		const seed = async (): Promise<string> => {
			const root = await repo();
			await writeFile(join(root, "okf", "tracked.md"), concept("Tracked", "Committed description"));
			await writeFile(join(root, "okf", "other.md"), concept("Other"));
			git(root, ["add", "."]);
			git(root, ["commit", "-q", "-m", "init"]);
			return root;
		};

		it.effect("omits an untracked concept under staged; lists it without staged", () =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(seed);
				try {
					yield* Effect.promise(() => writeFile(join(root, "okf", "draft.md"), concept("Untracked Draft")));
					const withStaged = yield* plan(root, true);
					assert.notInclude(rootIndex(withStaged), "Untracked Draft");
					assert.include(rootIndex(withStaged), "Tracked");
					const plain = yield* plan(root, false);
					assert.include(rootIndex(plain), "Untracked Draft");
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
		);

		it.effect("renders the indexed title of a tracked concept with unstaged edits", () =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(seed);
				try {
					yield* Effect.promise(() =>
						writeFile(join(root, "okf", "tracked.md"), concept("Unstaged Retitle", "Edited")),
					);
					const planned = yield* plan(root, true);
					assert.include(rootIndex(planned), "Tracked");
					assert.include(rootIndex(planned), "Committed description");
					assert.notInclude(rootIndex(planned), "Unstaged Retitle");
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
		);

		it.effect("keeps a concept deleted from the working tree but still indexed", () =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(seed);
				try {
					yield* Effect.promise(() => rm(join(root, "okf", "other.md")));
					const planned = yield* plan(root, true);
					assert.include(rootIndex(planned), "Other");
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
		);

		it.effect("drops a directory holding only untracked concepts from the parent and writes no index for it", () =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(seed);
				try {
					yield* Effect.promise(() => mkdir(join(root, "okf", "fresh")));
					yield* Effect.promise(() => writeFile(join(root, "okf", "fresh", "x.md"), concept("Fresh X")));
					const planned = yield* plan(root, true);
					assert.notInclude(rootIndex(planned), "fresh");
					assert.isFalse(planned.pending.some((write) => write.target.includes(join("okf", "fresh"))));
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
		);

		it.effect("still lists a staged concept and restages index.md", () =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(seed);
				try {
					yield* Effect.promise(() => writeFile(join(root, "okf", "added.md"), concept("Added Concept")));
					git(root, ["add", "okf/added.md"]);
					const planned = yield* plan(root, true);
					assert.include(rootIndex(planned), "Added Concept");
					assert.isTrue(planned.restage?.files.some((file) => file.endsWith(join("okf", "index.md"))));
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
		);
	});

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

	it.effect("sync --staged re-stamps a staged future-stamped concept and leaves an unstaged one (#471)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				const FUTURE = "2030-01-01T00:00:00Z";
				// c.md is staged and drifted: it takes the hook's instant (`staged.at`), not `now`.
				yield* Effect.promise(() =>
					writeFile(
						join(root, "okf", "c.md"),
						"---\ntype: Module\ntitle: C\ngenerated:\n  by: human:ada\n---\n\n# C\n",
					),
				);
				for (const [name, title] of [
					["a.md", "A"],
					["b.md", "B"],
				] as const) {
					const body = `\n# ${title}\n\nBody.\n`;
					const digest = yield* Derivation.bodyDigest(`---\ntype: Module\ntitle: ${title}\n---${body}`);
					yield* Effect.promise(() =>
						writeFile(
							join(root, "okf", name),
							`---\ntype: Module\ntitle: ${title}\ngenerated:\n  by: human:ada\n  at: ${FUTURE}\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n---${body}`,
						),
					);
				}
				git(root, ["add", "okf/a.md", "okf/c.md"]);
				const result = yield* runSync({
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated"]),
					dryRun: false,
					staged: { at: STAMP },
					now: DateTime.makeUnsafe("2026-09-16T10:00:07.400Z"),
				}).pipe(Effect.provide(live));
				assert.deepStrictEqual([...result.generated.written].sort(), ["a", "c"]);
				const c = yield* Effect.promise(() => readFile(join(root, "okf", "c.md"), "utf8"));
				assert.include(c, "  at: 2026-09-16T10:00:00Z\n", "a drifted staged concept takes staged.at");
				const a = yield* Effect.promise(() => readFile(join(root, "okf", "a.md"), "utf8"));
				const b = yield* Effect.promise(() => readFile(join(root, "okf", "b.md"), "utf8"));
				assert.include(a, "  at: 2026-09-16T10:00:07Z\n", "a repaired stamp is now, whole seconds");
				assert.notInclude(a, FUTURE);
				assert.include(b, `  at: ${FUTURE}\n`);
				assert.strictEqual(git(root, ["show", ":okf/a.md"]), a);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect(
		"a repair that would make a verification count is a skip, not a write, in a dry run and a real run (#471)",
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(repo);
				try {
					const body = "\n# A\n\nBody.\n";
					const text = (digest: string) =>
						`---\ntype: Module\ntitle: A\ngenerated:\n  by: human:ada\n  at: 2030-06-01T00:00:00Z\nverified:\n  - by: human:ada\n    at: 2029-01-01T00:00:00Z\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n---${body}`;
					const digest = yield* Derivation.bodyDigest(text("0".repeat(16)));
					const file = join(root, "okf", "a.md");
					yield* Effect.promise(() => writeFile(file, text(digest)));
					git(root, ["add", "okf/a.md"]);
					const before = yield* Effect.promise(() => readFile(file, "utf8"));
					for (const dryRun of [true, false]) {
						const result = yield* runSync({
							bundleRoot: join(root, "okf"),
							config: OkfitConfig.DEFAULTS,
							modes: new Set(["generated"]),
							dryRun,
							staged: { at: STAMP },
							now: DateTime.makeUnsafe("2026-09-16T10:00:07.400Z"),
						}).pipe(Effect.provide(live));
						assert.deepStrictEqual(result.generated.written, []);
						assert.deepStrictEqual(result.generated.skipped, [
							{
								id: "a",
								reason: "verified-after-now",
								generatedAt: "2030-06-01T00:00:00Z",
								verifiedAt: "2029-01-01T00:00:00Z",
							},
						]);
						assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), before);
					}
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("a staged edit does not lower a future stamp below a verification; the digest is re-recorded (#471)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(repo);
			try {
				const body = "\n# A\n\nEdited.\n";
				const file = join(root, "okf", "a.md");
				const text = `---\ntype: Module\ntitle: A\ngenerated:\n  by: human:ada\n  at: 2030-06-01T00:00:00Z\nverified:\n  - by: human:ada\n    at: 2029-01-01T00:00:00Z\nx-okfit-integrity:\n  generated:\n    body: 0000000000000000\n---${body}`;
				yield* Effect.promise(() => writeFile(file, text));
				git(root, ["add", "okf/a.md"]);
				const result = yield* runSync({
					bundleRoot: join(root, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated"]),
					dryRun: false,
					staged: { at: DateTime.makeUnsafe("2026-09-16T10:00:07.400Z") },
					now: DateTime.makeUnsafe("2026-09-16T10:00:07.400Z"),
				}).pipe(Effect.provide(live));
				assert.deepStrictEqual(result.generated.written, ["a"]);
				const out = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.include(out, "  at: 2030-06-01T00:00:00Z\n");
				assert.notInclude(out, "body: 0000000000000000");
				assert.include(out, "verified:\n  - by: human:ada\n    at: 2029-01-01T00:00:00Z\n");
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(TestPlatform)),
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

	it.effect("finds a repository defined only by GIT_DIR and GIT_WORK_TREE, with no .git on disk", () =>
		Effect.gen(function* () {
			const work = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-envrepo-")));
			const store = `${work}-git`;
			const saved = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE };
			const restore = () => {
				if (saved.dir === undefined) delete process.env.GIT_DIR;
				else process.env.GIT_DIR = saved.dir;
				if (saved.tree === undefined) delete process.env.GIT_WORK_TREE;
				else process.env.GIT_WORK_TREE = saved.tree;
			};
			try {
				const env = ["--git-dir", store, "--work-tree", work];
				git(work, ["init", "-q", "--bare", "-b", "main", store]);
				yield* Effect.promise(() => mkdir(join(work, "okf")));
				yield* Effect.promise(() => writeFile(join(work, "okf", "index.md"), "# Index\n"));
				yield* Effect.promise(() =>
					writeFile(
						join(work, "okf", "a.md"),
						"---\ntype: Module\ntitle: A\ngenerated:\n  by: human:ada\n---\n\n# A\n",
					),
				);
				git(work, [...env, "add", "okf/a.md"]);
				// A bare-dotfiles setup: the hook-safe lookup finds no .git, so only the env-honouring retry answers.
				process.env.GIT_DIR = store;
				process.env.GIT_WORK_TREE = work;
				const result = yield* runSync({
					bundleRoot: join(work, "okf"),
					config: OkfitConfig.DEFAULTS,
					modes: new Set(["generated"]),
					dryRun: true,
					staged: { at: STAMP },
				}).pipe(Effect.provide(live), Effect.ensuring(Effect.sync(restore)));
				assert.deepStrictEqual(result.generated.written, ["a"]);
			} finally {
				restore();
				yield* Effect.promise(() => rm(store, { recursive: true, force: true }));
				yield* Effect.promise(() => rm(work, { recursive: true, force: true }));
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
