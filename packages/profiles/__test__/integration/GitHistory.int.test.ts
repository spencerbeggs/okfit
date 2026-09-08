// Live GitHistory.layer over real git (P-32, P-33, P-34): one temp repository per describe, replayed in
// beforeAll through group A's builders, removed in afterAll, read-only in tests. The layer composition is
// the CLI's (P-30).

import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node"; // PN/src/index.ts:90; layer PN/dist/NodeServices.d.ts:33
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Git, GitCommand, NotARepositoryError } from "@effected/git"; // GIT/index.d.ts:1918, :65, :778
import { DateTime, Effect, Layer } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { GitHistory, GitHistoryError } from "../../src/GitHistory.js";
import {
	CONFLICT_ENTRIES,
	CONFLICT_LOG_ORDER,
	CONFLICT_PATH,
	CONFLICT_STEPS,
	F4_ENTRIES,
	F4_LOG_ORDER,
	F4_PATH_ORIGINAL,
	F4_PATH_RENAMED,
	F4_STEPS,
	FIXTURE_AUTHOR_EMAIL,
	FIXTURE_AUTHOR_NAME,
	UNICODE_PATH,
	UNICODE_STEPS,
} from "../fixtures/history.js";
import type { FixtureRepo } from "../utils/git.js";
import { buildRepo, buildUnbornRepo, makeTempDir, removeDir } from "../utils/git.js";

// EF/Layer.ts:1246, :1550. provideMerge keeps the raw spawner available to the fixture builders.
const TestLayer = Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(NodeServices.layer));
const run = <A, E>(effect: Effect.Effect<A, E, Git | GitHistory | ChildProcessSpawner.ChildProcessSpawner>) =>
	effect.pipe(Effect.provide(TestLayer));
const build = <A>(effect: Effect.Effect<A, never, ChildProcessSpawner.ChildProcessSpawner>): Promise<A> =>
	Effect.runPromise(run(effect)); // EF/Effect.ts:8944

const instant = (text: string): number => DateTime.toEpochMillis(DateTime.makeUnsafe(text)); // EF/DateTime.ts:1617, :653

describe("GitHistory.layer over the F4 history", () => {
	let repo: FixtureRepo;

	beforeAll(async () => {
		repo = await build(buildRepo(F4_STEPS));
	});
	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("lists entries newest first with %aI/%cI decoded to the pinned instants and the identity carried", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				const entries = yield* history.pathLog(repo.dir, F4_PATH_RENAMED);
				assert.deepStrictEqual(
					entries.map((entry) => entry.sha),
					F4_LOG_ORDER.map((name) => repo.shas[name]),
				);
				assert.strictEqual(entries.length, F4_ENTRIES.length);
				for (const [index, entry] of entries.entries()) {
					const expected = F4_ENTRIES[index]!; // F4_ENTRIES is F4_LOG_ORDER mapped, so the index lines up
					assert.strictEqual(DateTime.toEpochMillis(entry.authoredAt), instant(expected.authoredAt), expected.name);
					assert.strictEqual(DateTime.toEpochMillis(entry.committedAt), instant(expected.committedAt), expected.name);
					assert.strictEqual(entry.authorName, FIXTURE_AUTHOR_NAME);
					assert.strictEqual(entry.authorEmail, FIXTURE_AUTHOR_EMAIL);
				}
				// c4 is the stamp whose committer date differs from its author date (P-4, P-33).
				const c4 = entries[F4_LOG_ORDER.indexOf("c4")]!;
				assert.notStrictEqual(DateTime.toEpochMillis(c4.authoredAt), DateTime.toEpochMillis(c4.committedAt));
			}),
		),
	);
	it.effect("--follow crosses c5's rename and every entry carries the path the blob had at that commit", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				const entries = yield* history.pathLog(repo.dir, F4_PATH_RENAMED);
				assert.deepStrictEqual(
					entries.map((entry) => entry.path),
					[
						F4_PATH_RENAMED, // c6
						F4_PATH_RENAMED, // topic
						F4_PATH_RENAMED, // c5: the rename's newer entry carries the new path
						F4_PATH_ORIGINAL, // c4
						F4_PATH_ORIGINAL, // c3
						F4_PATH_ORIGINAL, // c2
						F4_PATH_ORIGINAL, // c1
					],
				);
			}),
		),
	);
	it.effect("the --no-ff merge c6 and its topic commit are both listed, with path lines", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				const entries = yield* history.pathLog(repo.dir, F4_PATH_RENAMED, { limit: 2 });
				assert.deepStrictEqual(
					entries.map((entry) => [entry.sha, entry.path]),
					[
						[repo.shas.c6, F4_PATH_RENAMED],
						[repo.shas.topic, F4_PATH_RENAMED],
					],
				);
			}),
		),
	);
	it.effect("limit becomes --max-count", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				assert.strictEqual((yield* history.pathLog(repo.dir, F4_PATH_RENAMED, { limit: 3 })).length, 3);
				assert.strictEqual((yield* history.pathLog(repo.dir, F4_PATH_RENAMED, { limit: 1 }))[0]?.sha, repo.shas.c6);
			}),
		),
	);
	it.effect("cwd may be a subdirectory with a cwd-relative path; entry paths stay repository-relative", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				const [first, ...rest] = F4_PATH_RENAMED.split("/"); // "okf" and ["modules", "core-lib.md"]
				const entries = yield* history.pathLog(join(repo.dir, first!), rest.join("/"));
				assert.deepStrictEqual(
					entries.map((entry) => entry.sha),
					F4_LOG_ORDER.map((name) => repo.shas[name]),
				);
				assert.strictEqual(entries[0]?.path, F4_PATH_RENAMED);
			}),
		),
	);
	it.effect("an untracked path is an empty history", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				assert.deepStrictEqual(yield* history.pathLog(repo.dir, "okf/modules/never-added.md"), []);
			}),
		),
	);
	it.effect("a pathspec git rejects surfaces as GitHistoryError with the exit code and stderr (the `failed` row)", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				const error = yield* Effect.flip(history.pathLog(repo.dir, "../outside.md")); // EF/Effect.ts:2480
				assert.instanceOf(error, GitHistoryError);
				if (error instanceof GitHistoryError) {
					assert.strictEqual(error.exitCode, 128);
					assert.strictEqual(error.cwd, repo.dir);
					assert.deepStrictEqual(error.args, GitCommand.log(["../outside.md"], true, undefined, true).redactedArgs);
					assert.include(error.stderr, "is outside repository");
					assert.include(error.message, "(exit 128)");
				}
			}),
		),
	);
	it.effect("Git.repoRoot answers the realpath of the fixture directory (P-34)", () =>
		run(
			Effect.gen(function* () {
				const git = yield* Git;
				const expected = yield* Effect.promise(() => realpath(repo.dir));
				assert.strictEqual(yield* git.repoRoot(repo.dir), expected); // GIT/index.d.ts:1587
			}),
		),
	);
});

describe("GitHistory.layer outside a history", () => {
	let unborn = "";
	let plain = "";

	beforeAll(async () => {
		unborn = await build(buildUnbornRepo());
		plain = await Effect.runPromise(makeTempDir("okfit-profiles-plain-")); // makeTempDir is an Effect (group A)
	});
	afterAll(async () => {
		await removeDir(unborn);
		await removeDir(plain);
	});

	it.effect("an unborn HEAD is an empty history (P-11)", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				assert.deepStrictEqual(yield* history.pathLog(unborn, F4_PATH_ORIGINAL), []);
			}),
		),
	);
	it.effect("a plain directory fails NotARepositoryError carrying the cwd", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				const error = yield* Effect.flip(history.pathLog(plain, F4_PATH_ORIGINAL));
				assert.instanceOf(error, NotARepositoryError);
				assert.strictEqual(error.cwd, plain);
			}),
		),
	);
});

describe("GitHistory.layer over a conflict-resolving merge", () => {
	let repo: FixtureRepo;

	beforeAll(async () => {
		repo = await build(buildRepo(CONFLICT_STEPS));
	});
	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("a merge whose blob differs from both parents is listed newest, with a path line (P-46)", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				const entries = yield* history.pathLog(repo.dir, CONFLICT_PATH);
				// Plain --follow would answer [m3, m2, m1]; --diff-merges=first-parent adds m4 at the head (probed).
				assert.deepStrictEqual(
					entries.map((entry) => entry.sha),
					CONFLICT_LOG_ORDER.map((name) => repo.shas[name]),
				);
				assert.strictEqual(entries[0]?.path, CONFLICT_PATH);
				assert.strictEqual(DateTime.toEpochMillis(entries[0]!.authoredAt), instant(CONFLICT_ENTRIES[0]!.authoredAt));
			}),
		),
	);
});

describe("GitHistory.layer over a non-ASCII path (decision 56, -c core.quotePath=false)", () => {
	let repo: FixtureRepo;

	beforeAll(async () => {
		repo = await build(buildRepo(UNICODE_STEPS));
	});
	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("the --name-only line comes back as the raw UTF-8 name, never C-style-quoted", () =>
		run(
			Effect.gen(function* () {
				const history = yield* GitHistory;
				const entries = yield* history.pathLog(repo.dir, UNICODE_PATH);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0]?.path, UNICODE_PATH);
				assert.isFalse(entries[0]?.path.startsWith('"'));
				assert.strictEqual(entries[0]?.sha, repo.shas.u1);
			}),
		),
	);
});
