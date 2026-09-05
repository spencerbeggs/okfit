import { assert, describe, it } from "@effect/vitest";
import { Git, NotARepositoryError } from "@effected/git";
import { Actor, OkfitConfig } from "@okfit/core";
import { Cause, DateTime, Duration, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect";
import { AgentActorUnconfiguredError, Derivation, HumanActorUnresolvedError } from "../src/Derivation.js";
import { GitHistory } from "../src/GitHistory.js";
import type { F4CommitName } from "./fixtures/history.js";
import {
	F4_ENTRIES,
	F4_EXPECTED_BODY_COMMIT_AT_HEAD,
	F4_EXPECTED_BODY_COMMIT_BEFORE_MERGE,
	F4_LOG_ORDER,
	F4_TEXTS,
	FIXTURE_AUTHOR_EMAIL,
	FIXTURE_AUTHOR_NAME,
} from "./fixtures/history.js";
import { FILE, REL, ROOT, blobsOf, entriesOf, identityGit, windowsPath, world } from "./utils/derivation.js";

const actor = Schema.decodeUnknownSync(Actor);
const utc = (iso: string): number => DateTime.toEpochMillis(DateTime.makeUnsafe(iso));
const from = DateTime.makeUnsafe("2026-03-01T08:00:00Z");
/** The fixture commit by name; `F4_ENTRIES` carries every F4 commit (group A). */
const byName = (name: F4CommitName) => F4_ENTRIES.find((commit) => commit.name === name)!;
/** The path log as it would read at `HEAD = name`: `F4_ENTRIES` from that commit down (newest first). */
const logAt = (name: F4CommitName) => F4_ENTRIES.slice(F4_LOG_ORDER.indexOf(name));
const HEAD_TEXT = F4_TEXTS.c6;
const STAMP_EDIT = HEAD_TEXT.replace("stale_after: 2026-05-30T08:00:00Z", "stale_after: 2030-01-01T00:00:00Z");
const history = entriesOf(F4_ENTRIES);
const blobs = blobsOf(F4_ENTRIES);

describe("Derivation.body", () => {
	it("strips the frontmatter block, normalises CRLF and CR to LF, and trims trailing whitespace (P-6)", () => {
		assert.strictEqual(Derivation.body("---\ntitle: x\n---\r\nline one\r\nline two\r\n\r\n"), "line one\nline two");
		assert.strictEqual(Derivation.body("line one\rline two \n"), "line one\nline two");
		assert.strictEqual(Derivation.body("---\ntitle: x\n---"), "");
		assert.strictEqual(Derivation.body("---\ntitle: x\n---\n\n# Body\n"), "\n# Body");
		assert.strictEqual(Derivation.body("no frontmatter\n"), "no frontmatter");
	});
});

describe("Derivation.generatedAt (P-2, P-9, P-39)", () => {
	it.effect("at HEAD = c6 returns the topic commit: the merge's body equals it and c4's stamp is skipped", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.strictEqual(result._tag, "committed");
			if (result._tag !== "committed") return;
			const topic = byName(F4_EXPECTED_BODY_COMMIT_AT_HEAD);
			const c4 = byName("c4");
			assert.strictEqual(result.sha, topic.sha);
			assert.strictEqual(DateTime.toEpochMillis(result.at), utc("2026-06-01T08:00:00Z"));
			assert.strictEqual(DateTime.toEpochMillis(result.committedAt), utc(topic.committedAt));
			assert.notStrictEqual(result.sha, byName("c6").sha);
			assert.notStrictEqual(result.sha, c4.sha);
			assert.notStrictEqual(DateTime.toEpochMillis(result.at), utc(c4.authoredAt));
			assert.notStrictEqual(DateTime.toEpochMillis(result.at), utc(c4.committedAt));
			assert.strictEqual(result.authorName, FIXTURE_AUTHOR_NAME);
			assert.strictEqual(result.authorEmail, FIXTURE_AUTHOR_EMAIL);
		}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.some(HEAD_TEXT), blobs, history }))),
	);
	it.effect("at HEAD = c5 returns c3's author date, not c4's stamp or committer date, across the rename", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.strictEqual(result._tag, "committed");
			if (result._tag !== "committed") return;
			const c3 = byName(F4_EXPECTED_BODY_COMMIT_BEFORE_MERGE);
			const c4 = byName("c4");
			assert.strictEqual(result.sha, c3.sha);
			assert.strictEqual(DateTime.toEpochMillis(result.at), utc("2026-03-01T08:00:00Z"));
			assert.strictEqual(DateTime.toEpochMillis(result.committedAt), utc(c3.committedAt));
			assert.notStrictEqual(result.sha, byName("c5").sha);
			assert.notStrictEqual(result.sha, c4.sha);
			assert.notStrictEqual(DateTime.toEpochMillis(result.at), utc(c4.authoredAt));
			assert.notStrictEqual(DateTime.toEpochMillis(result.at), utc(c4.committedAt));
		}).pipe(
			Effect.provide(
				world({ worktree: F4_TEXTS.c5, head: Option.some(F4_TEXTS.c5), blobs, history: entriesOf(logAt("c5")) }),
			),
		),
	);
	it.effect("accepts config and ignores it (P-48)", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE, config: OkfitConfig.DEFAULTS });
			assert.strictEqual(result._tag, "committed");
			if (result._tag === "committed") assert.strictEqual(result.sha, byName(F4_EXPECTED_BODY_COMMIT_AT_HEAD).sha);
		}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.some(HEAD_TEXT), blobs, history }))),
	);
	it.effect("a worktree whose body differs from HEAD's blob is dirty, and the log is never consulted", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.deepStrictEqual(result, { _tag: "uncommitted", reason: "dirty" });
		}).pipe(
			Effect.provide(world({ worktree: `${HEAD_TEXT}\nAn uncommitted paragraph.\n`, head: Option.some(HEAD_TEXT) })),
		),
	);
	it.effect("a frontmatter-only worktree edit is still committed at the topic commit", () =>
		Effect.gen(function* () {
			assert.notStrictEqual(STAMP_EDIT, HEAD_TEXT); // the fixture text carries the stamp line the edit rewrites
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.strictEqual(result._tag, "committed");
			if (result._tag === "committed") assert.strictEqual(result.sha, byName(F4_EXPECTED_BODY_COMMIT_AT_HEAD).sha);
		}).pipe(Effect.provide(world({ worktree: STAMP_EDIT, head: Option.some(HEAD_TEXT), blobs, history }))),
	);
	it.effect("a CRLF worktree against an LF blob is committed (P-6)", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.strictEqual(result._tag, "committed");
			if (result._tag === "committed") assert.strictEqual(result.sha, byName(F4_EXPECTED_BODY_COMMIT_AT_HEAD).sha);
		}).pipe(
			Effect.provide(
				world({ worktree: HEAD_TEXT.replace(/\n/g, "\r\n"), head: Option.some(HEAD_TEXT), blobs, history }),
			),
		),
	);
	it.effect("an unborn HEAD is uncommitted { unborn } before the log is consulted (P-11, P-47)", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.deepStrictEqual(result, { _tag: "uncommitted", reason: "unborn" });
		}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: "unborn" }))),
	);
	it.effect("a path absent from HEAD is uncommitted { untracked } before the log is consulted (P-47)", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.deepStrictEqual(result, { _tag: "uncommitted", reason: "untracked" });
		}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.none() }))),
	);
	it.effect("an empty path log is uncommitted { unborn }", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.deepStrictEqual(result, { _tag: "uncommitted", reason: "unborn" });
		}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.some(HEAD_TEXT), blobs, history: [] }))),
	);
	it.effect("returns the creating commit when every blob body is identical", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.strictEqual(result._tag, "committed");
			if (result._tag === "committed") {
				assert.strictEqual(result.sha, byName("c1").sha);
				assert.strictEqual(DateTime.toEpochMillis(result.at), utc("2026-01-01T08:00:00Z"));
			}
		}).pipe(
			Effect.provide(
				world({
					worktree: F4_TEXTS.c2,
					head: Option.some(F4_TEXTS.c2),
					blobs: blobsOf([byName("c2"), byName("c1")]),
					history: entriesOf([byName("c2"), byName("c1")]),
				}),
			),
		),
	);
	it.effect("an older entry whose blob is absent stops the walk at the entry above it", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.strictEqual(result._tag, "committed");
			if (result._tag === "committed") assert.strictEqual(result.sha, byName("c4").sha);
		}).pipe(
			Effect.provide(
				world({
					worktree: F4_TEXTS.c4,
					head: Option.some(F4_TEXTS.c4),
					blobs: blobsOf([byName("c4")]),
					history: entriesOf([byName("c4"), byName("c3")]),
				}),
			),
		),
	);
	it.effect("a single-entry path history returns that entry without ever running the comparison loop", () => {
		const only = byName("c1");
		return Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: FILE });
			assert.strictEqual(result._tag, "committed");
			if (result._tag !== "committed") return;
			assert.strictEqual(result.sha, only.sha);
			assert.strictEqual(DateTime.toEpochMillis(result.at), utc(only.authoredAt));
			assert.strictEqual(DateTime.toEpochMillis(result.committedAt), utc(only.committedAt));
			assert.strictEqual(result.authorName, only.authorName);
			assert.strictEqual(result.authorEmail, only.authorEmail);
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					Git.layerTest({
						repoRoot: () => Effect.succeed(ROOT),
						show: (_cwd, ref, path) => {
							if (ref === "HEAD" && path === REL) return Effect.succeed(Option.some(F4_TEXTS.c1));
							if (ref === only.sha && path === only.path) return Effect.succeed(Option.some(F4_TEXTS.c1));
							return Effect.die(new Error(`unexpected show(${ref}, ${path})`));
						},
					}),
					GitHistory.layerTest({ [REL]: entriesOf([only]) }),
					FileSystem.layerNoop({
						readFileString: (path) =>
							path === FILE ? Effect.succeed(F4_TEXTS.c1) : Effect.die(new Error(`unexpected readFileString(${path})`)),
						realPath: (path) => Effect.succeed(path),
					}),
					Path.layer,
				),
			),
		);
	});
	it.effect("also ignores a non-default lifecycle config (P-48)", () =>
		Effect.gen(function* () {
			const config: OkfitConfig = { lifecycle: { default_stale_after: Duration.days(7) }, extensions: {} };
			const result = yield* Derivation.generatedAt({ file: FILE, config });
			assert.strictEqual(result._tag, "committed");
			if (result._tag === "committed") assert.strictEqual(result.sha, byName(F4_EXPECTED_BODY_COMMIT_AT_HEAD).sha);
		}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.some(HEAD_TEXT), blobs, history }))),
	);
	it.effect("realpath-resolves root and file before computing the repo-relative path (P-39)", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: "/var/w/repo/okf/modules/core-lib.md" });
			assert.strictEqual(result._tag, "committed");
			if (result._tag === "committed") assert.strictEqual(result.sha, byName(F4_EXPECTED_BODY_COMMIT_AT_HEAD).sha);
		}).pipe(
			Effect.provide(
				world({
					root: "/private/var/w/repo",
					file: "/var/w/repo/okf/modules/core-lib.md",
					realPaths: { "/var/w/repo/okf/modules/core-lib.md": "/private/var/w/repo/okf/modules/core-lib.md" },
					worktree: HEAD_TEXT,
					head: Option.some(HEAD_TEXT),
					blobs,
					history,
				}),
			),
		),
	);
	it.effect("converts a Windows path.sep to posix for git (P-39)", () =>
		Effect.gen(function* () {
			const result = yield* Derivation.generatedAt({ file: "C:\\repo\\okf\\modules\\core-lib.md" });
			assert.strictEqual(result._tag, "committed");
			if (result._tag === "committed") assert.strictEqual(result.sha, byName(F4_EXPECTED_BODY_COMMIT_AT_HEAD).sha);
		}).pipe(
			Effect.provide(
				world({
					root: "C:\\repo",
					file: "C:\\repo\\okf\\modules\\core-lib.md",
					worktree: HEAD_TEXT,
					head: Option.some(HEAD_TEXT),
					blobs,
					history,
					path: windowsPath,
				}),
			),
		),
	);
	it.effect("NotARepositoryError from repoRoot propagates (P-11)", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Derivation.generatedAt({ file: "/elsewhere/note.md" }));
			assert.instanceOf(error, NotARepositoryError);
			assert.strictEqual(error.cwd, "/elsewhere");
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					Git.layerTest({ repoRoot: (cwd) => Effect.fail(new NotARepositoryError({ cwd })) }),
					GitHistory.layerTest({}),
					FileSystem.layerNoop({}),
					Path.layer,
				),
			),
		),
	);
	it.effect("an unstubbed Git member dies, naming itself (P-32)", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(Derivation.generatedAt({ file: FILE }));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.isTrue(Cause.hasDies(exit.cause));
				const die = exit.cause.reasons.find(Cause.isDieReason);
				assert.isDefined(die);
				assert.instanceOf(die?.defect, Error);
				if (die !== undefined && die.defect instanceof Error) assert.include(die.defect.message, "repoRoot");
			}
		}).pipe(
			Effect.provide(Layer.mergeAll(Git.layerTest({}), GitHistory.layerTest({}), FileSystem.layerNoop({}), Path.layer)),
		),
	);
});

describe("Derivation.humanActorId (P-13, P-14)", () => {
	it("returns the config spelling on a case-insensitive match of the email local part", () => {
		const result = Derivation.humanActorId({ name: "C. Spencer Beggs", email: "Spencer@beggs.codes" }, [
			actor("human:spencer"),
		]);
		assert.deepStrictEqual(result, Option.some("human:spencer"));
		const spelled = Derivation.humanActorId({ email: "spencer@beggs.codes" }, [actor("human:Spencer")]);
		assert.deepStrictEqual(spelled, Option.some("human:Spencer"));
	});
	it("matches a config entry against the name slug when there is no email", () => {
		const result = Derivation.humanActorId({ name: "C. Spencer Beggs" }, [actor("human:C.-Spencer-Beggs")]);
		assert.deepStrictEqual(result, Option.some("human:C.-Spencer-Beggs"));
	});
	it("ignores config entries that are not human: prefixed", () => {
		const result = Derivation.humanActorId({ email: "spencer@beggs.codes" }, [
			actor("team:spencer"),
			actor("process:spencer"),
		]);
		assert.deepStrictEqual(result, Option.some("human:spencer"));
	});
	it("falls back to the email local part when no config entry matches", () => {
		const result = Derivation.humanActorId({ name: "C. Spencer Beggs", email: "spencer@beggs.codes" }, [
			actor("human:cspencer"),
		]);
		assert.deepStrictEqual(result, Option.some("human:spencer"));
		assert.deepStrictEqual(Derivation.humanActorId({ email: "spencer" }, []), Option.some("human:spencer"));
	});
	it("slugs user.name when there is no usable email", () => {
		assert.deepStrictEqual(
			Derivation.humanActorId({ name: "C. Spencer Beggs" }, []),
			Option.some("human:c.-spencer-beggs"),
		);
		assert.deepStrictEqual(
			Derivation.humanActorId({ name: "Jane Q. O'Brien-Smith", email: "@example.com" }, []),
			Option.some("human:jane-q.-o-brien-smith"),
		);
		assert.deepStrictEqual(
			Derivation.humanActorId({ name: "  Ada   Lovelace  " }, []),
			Option.some("human:ada-lovelace"),
		);
	});
	it("is none when neither name nor email yields a candidate", () => {
		assert.deepStrictEqual(Derivation.humanActorId({}, [actor("human:spencer")]), Option.none());
		assert.deepStrictEqual(Derivation.humanActorId({ name: "!!!", email: "@example.com" }, []), Option.none());
		assert.deepStrictEqual(Derivation.humanActorId({ email: "first last@example.com" }, []), Option.none());
	});
	it("always yields a value core's Actor codec accepts", () => {
		for (const identity of [
			{ name: "C. Spencer Beggs" },
			{ email: "jsmith@acme.example" },
			{ name: "x y", email: "a@b" },
		]) {
			const result = Derivation.humanActorId(identity, []);
			assert.isTrue(Option.isSome(result));
			if (Option.isSome(result)) {
				assert.strictEqual(actor(result.value), result.value);
				assert.isTrue(Actor.isHuman(result.value));
			}
		}
	});
});

describe("Derivation.generatedBy (P-16, P-17)", () => {
	it.effect("agent: returns actors.agent without touching git", () =>
		Effect.gen(function* () {
			const config: OkfitConfig = { actors: { agent: actor("okfit/claude-code") }, extensions: {} };
			const by = yield* Derivation.generatedBy({ writer: "agent", cwd: "/repo", config });
			assert.strictEqual(by, "okfit/claude-code");
		}).pipe(Effect.provide(Git.layerTest({}))),
	);
	it.effect("agent: fails AgentActorUnconfiguredError when actors.agent is unset", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Derivation.generatedBy({ writer: "agent", cwd: "/repo", config: OkfitConfig.DEFAULTS }),
			);
			assert.instanceOf(error, AgentActorUnconfiguredError);
			assert.strictEqual(error._tag, "AgentActorUnconfiguredError");
			assert.strictEqual(error.message, "writer is agent but actors.agent is not configured");
		}).pipe(Effect.provide(Git.layerTest({}))),
	);
	it.effect("human: reads user.name and user.email in merged scope and derives the local part", () =>
		Effect.gen(function* () {
			const calls: Array<{ readonly key: string; readonly options: unknown }> = [];
			const git = identityGit({ "user.name": "Okfit Test", "user.email": "okfit-test@example.com" }, calls);
			const by = yield* Derivation.generatedBy({ writer: "human", cwd: "/repo", config: OkfitConfig.DEFAULTS }).pipe(
				Effect.provide(git),
			);
			assert.strictEqual(by, "human:okfit-test");
			assert.deepStrictEqual(
				calls.map((call) => call.key),
				["user.name", "user.email"],
			);
			assert.isTrue(calls.every((call) => call.options === undefined));
		}),
	);
	it.effect("human: config.actors.humans wins with its own spelling", () =>
		Effect.gen(function* () {
			const git = identityGit({ "user.email": "okfit-test@example.com" });
			const config: OkfitConfig = { actors: { humans: [actor("human:Okfit-Test")] }, extensions: {} };
			const by = yield* Derivation.generatedBy({ writer: "human", cwd: "/repo", config }).pipe(Effect.provide(git));
			assert.strictEqual(by, "human:Okfit-Test");
		}),
	);
	it.effect("human: fails HumanActorUnresolvedError carrying what git answered", () =>
		Effect.gen(function* () {
			const nothing = yield* Effect.flip(
				Derivation.generatedBy({ writer: "human", cwd: "/repo", config: OkfitConfig.DEFAULTS }).pipe(
					Effect.provide(identityGit({})),
				),
			);
			assert.instanceOf(nothing, HumanActorUnresolvedError);
			// Decision 53: fields are userName/userEmail, not name/email, so error.name always reads the class name. (checked)
			assert.isFalse(Object.hasOwn(nothing, "userName"));
			assert.isFalse(Object.hasOwn(nothing, "userEmail"));
			assert.strictEqual(nothing.userEmail, undefined);
			assert.strictEqual(
				nothing.message,
				"git has no user.name or user.email to derive a human actor from; set one or add actors.humans",
			);
			const unusable = yield* Effect.flip(
				Derivation.generatedBy({ writer: "human", cwd: "/repo", config: { extensions: {} } }).pipe(
					Effect.provide(identityGit({ "user.name": "!!!" })),
				),
			);
			assert.instanceOf(unusable, HumanActorUnresolvedError);
			assert.isTrue(Object.hasOwn(unusable, "userName"));
			assert.strictEqual(unusable.userName, "!!!");
			assert.isFalse(Object.hasOwn(unusable, "userEmail"));
		}),
	);
});

describe("Derivation.staleAfter (P-19)", () => {
	it("adds lifecycle.default_stale_after, falling back to DEFAULTS' 90 days", () => {
		assert.strictEqual(
			DateTime.toEpochMillis(Derivation.staleAfter(from, OkfitConfig.DEFAULTS)),
			utc("2026-05-30T08:00:00Z"),
		);
		const thirty: OkfitConfig = { lifecycle: { default_stale_after: Duration.days(30) }, extensions: {} };
		assert.strictEqual(DateTime.toEpochMillis(Derivation.staleAfter(from, thirty)), utc("2026-03-31T08:00:00Z"));
		assert.strictEqual(
			DateTime.toEpochMillis(Derivation.staleAfter(from, { extensions: {} })),
			utc("2026-05-30T08:00:00Z"),
		);
		assert.strictEqual(
			DateTime.toEpochMillis(Derivation.staleAfter(from, { lifecycle: {}, extensions: {} })),
			DateTime.toEpochMillis(DateTime.addDuration(from, OkfitConfig.DEFAULTS.lifecycle!.default_stale_after!)),
		);
		assert.isTrue(Duration.equals(OkfitConfig.DEFAULTS.lifecycle!.default_stale_after!, Duration.days(90)));
	});
});
