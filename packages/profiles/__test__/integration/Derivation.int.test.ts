import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Git, NotARepositoryError } from "@effected/git";
import { Actor, OkfitConfig, Timestamp } from "@okfit/core";
import { DateTime, Effect, Layer, Schema } from "effect";
import { Derivation } from "../../src/Derivation.js";
import { GitHistory } from "../../src/GitHistory.js";
import {
	CONFLICT_EXPECTED_BODY_COMMIT,
	CONFLICT_PATH,
	CONFLICT_STEPS,
	F4_EXPECTED_BODY_COMMIT_AT_HEAD,
	F4_EXPECTED_BODY_COMMIT_BEFORE_MERGE,
	F4_PATH_RENAMED,
	F4_STEPS,
	FIXTURE_AUTHOR_EMAIL,
	FIXTURE_AUTHOR_NAME,
} from "../fixtures/history.js";
import type { FixtureRepo } from "../utils/git.js";
import { buildRepo, buildUnbornRepo, git, makeTempDir, removeDir } from "../utils/git.js";

// P-30: both live layers over the real spawner; provideMerge keeps FileSystem, Path and the spawner in scope
// (EF/Layer.ts:1246, :1550; PN/dist/NodeServices.d.ts:25, :33).
const TestLayer = Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(NodeServices.layer));
const run = <A, E>(effect: Effect.Effect<A, E, Git | GitHistory | NodeServices.NodeServices>): Effect.Effect<A, E> =>
	effect.pipe(Effect.provide(TestLayer));
const build = <A>(effect: Effect.Effect<A, never, NodeServices.NodeServices>): Promise<A> =>
	Effect.runPromise(run(effect)); // EF/Effect.ts:8944

const decodeTimestamp = Schema.decodeUnknownSync(Timestamp);
const actor = Schema.decodeUnknownSync(Actor);

/** The author (`%aI`) or committer (`%cI`) date of `sha` as git reports it, through core's Timestamp codec (P-4). */
const dateOf = (dir: string, sha: string, format: "%aI" | "%cI") =>
	git(dir, ["log", "-1", `--format=${format}`, sha]).pipe(
		Effect.map((stdout) => DateTime.toEpochMillis(decodeTimestamp(stdout))),
	);

const STAMP_ONLY_EDIT = "---\ntags: [architecture]\n"; // replaces the opening fence: a frontmatter-only change

describe("Derivation over the replayed F4 history at HEAD = c6 (P-33)", () => {
	let repo: FixtureRepo;
	let file = "";

	beforeAll(async () => {
		repo = await build(buildRepo(F4_STEPS));
		file = join(repo.dir, F4_PATH_RENAMED);
	});
	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("generatedAt is the topic commit's author date: not the --no-ff merge, not c4's stamp", () =>
		run(
			Effect.gen(function* () {
				const result = yield* Derivation.generatedAt({ file });
				assert.strictEqual(result._tag, "committed");
				if (result._tag !== "committed") return;
				const expected = repo.shas[F4_EXPECTED_BODY_COMMIT_AT_HEAD]!;
				const c4 = repo.shas.c4!;
				assert.strictEqual(result.sha, expected);
				assert.strictEqual(DateTime.toEpochMillis(result.at), yield* dateOf(repo.dir, expected, "%aI"));
				assert.strictEqual(DateTime.toEpochMillis(result.committedAt), yield* dateOf(repo.dir, expected, "%cI"));
				assert.notStrictEqual(result.sha, repo.shas.c6);
				assert.notStrictEqual(result.sha, c4);
				assert.notStrictEqual(DateTime.toEpochMillis(result.at), yield* dateOf(repo.dir, c4, "%aI"));
				assert.notStrictEqual(DateTime.toEpochMillis(result.at), yield* dateOf(repo.dir, c4, "%cI"));
				assert.strictEqual(result.authorName, FIXTURE_AUTHOR_NAME);
				assert.strictEqual(result.authorEmail, FIXTURE_AUTHOR_EMAIL);
			}),
		),
	);

	it.effect("generatedBy human reads the repo-local identity (P-15)", () =>
		run(
			Effect.gen(function* () {
				const by = yield* Derivation.generatedBy({ writer: "human", cwd: repo.dir, config: OkfitConfig.DEFAULTS });
				assert.strictEqual(by, "human:okfit-test");
				const pinned: OkfitConfig = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
					actors: { humans: [actor("human:Okfit-Test")] },
					extensions: {},
				});
				assert.strictEqual(
					yield* Derivation.generatedBy({ writer: "human", cwd: repo.dir, config: pinned }),
					"human:Okfit-Test",
				);
			}),
		),
	);
});

describe("Derivation over the F4 history at HEAD = c5, before the merge", () => {
	let repo: FixtureRepo;
	let file = "";

	beforeAll(async () => {
		repo = await build(buildRepo(F4_STEPS.slice(0, 5))); // c1..c4 writes and the c5 rename; no branch, no merge
		file = join(repo.dir, F4_PATH_RENAMED);
	});
	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("generatedAt is c3's author date, not c4's stamp or committer date, across the rename", () =>
		run(
			Effect.gen(function* () {
				assert.strictEqual(repo.shas.topic, undefined); // the slice really stops at the rename
				const result = yield* Derivation.generatedAt({ file });
				assert.strictEqual(result._tag, "committed");
				if (result._tag !== "committed") return;
				const expected = repo.shas[F4_EXPECTED_BODY_COMMIT_BEFORE_MERGE]!;
				const c4 = repo.shas.c4!;
				assert.strictEqual(result.sha, expected);
				assert.strictEqual(DateTime.toEpochMillis(result.at), yield* dateOf(repo.dir, expected, "%aI"));
				assert.strictEqual(DateTime.toEpochMillis(result.committedAt), yield* dateOf(repo.dir, expected, "%cI"));
				assert.notStrictEqual(result.sha, repo.shas.c5);
				assert.notStrictEqual(result.sha, c4);
				assert.notStrictEqual(DateTime.toEpochMillis(result.at), yield* dateOf(repo.dir, c4, "%aI"));
				assert.notStrictEqual(DateTime.toEpochMillis(result.at), yield* dateOf(repo.dir, c4, "%cI"));
			}),
		),
	);
});

describe("Derivation over a body-dirty worktree", () => {
	let repo: FixtureRepo;
	let file = "";

	beforeAll(async () => {
		repo = await build(buildRepo(F4_STEPS));
		file = join(repo.dir, F4_PATH_RENAMED);
		const text = await readFile(file, "utf8");
		await writeFile(file, `${text}\nAn uncommitted paragraph.\n`);
	});
	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("reports uncommitted { dirty } and never substitutes now (P-9, P-10)", () =>
		run(
			Effect.gen(function* () {
				const result = yield* Derivation.generatedAt({ file });
				assert.deepStrictEqual(result, { _tag: "uncommitted", reason: "dirty" });
			}),
		),
	);
});

describe("Derivation over a frontmatter-only worktree edit", () => {
	let repo: FixtureRepo;
	let file = "";

	beforeAll(async () => {
		repo = await build(buildRepo(F4_STEPS));
		file = join(repo.dir, F4_PATH_RENAMED);
		const text = await readFile(file, "utf8");
		await writeFile(file, text.replace("---\n", STAMP_ONLY_EDIT));
	});
	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("is still committed at the topic commit: a stamp being written is not a body change", () =>
		run(
			Effect.gen(function* () {
				assert.isTrue((yield* Effect.promise(() => readFile(file, "utf8"))).startsWith(STAMP_ONLY_EDIT));
				const result = yield* Derivation.generatedAt({ file });
				assert.strictEqual(result._tag, "committed");
				if (result._tag === "committed") assert.strictEqual(result.sha, repo.shas[F4_EXPECTED_BODY_COMMIT_AT_HEAD]);
			}),
		),
	);
});

describe("Derivation over a conflict-resolving merge (P-46)", () => {
	let repo: FixtureRepo;
	let file = "";

	beforeAll(async () => {
		repo = await build(buildRepo(CONFLICT_STEPS));
		file = join(repo.dir, CONFLICT_PATH);
	});
	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("a clean worktree at the merge is committed at the merge's sha and author date, not dirty", () =>
		run(
			Effect.gen(function* () {
				const result = yield* Derivation.generatedAt({ file });
				assert.strictEqual(result._tag, "committed");
				if (result._tag !== "committed") return;
				const expected = repo.shas[CONFLICT_EXPECTED_BODY_COMMIT]!;
				assert.strictEqual(result.sha, expected);
				assert.strictEqual(DateTime.toEpochMillis(result.at), yield* dateOf(repo.dir, expected, "%aI"));
				assert.notStrictEqual(result.sha, repo.shas.m3);
			}),
		),
	);
});

describe("Derivation over an unborn HEAD (P-11)", () => {
	let dir = "";
	let file = "";

	beforeAll(async () => {
		dir = await build(buildUnbornRepo());
		await mkdir(join(dir, "okf", "modules"), { recursive: true });
		file = join(dir, "okf", "modules", "core.md");
		await writeFile(file, "---\ntype: Module\ntitle: Core\n---\n\n# Core\n");
	});
	afterAll(async () => {
		await removeDir(dir);
	});

	it.effect("reports uncommitted { unborn }", () =>
		run(
			Effect.gen(function* () {
				const result = yield* Derivation.generatedAt({ file });
				assert.deepStrictEqual(result, { _tag: "uncommitted", reason: "unborn" });
			}),
		),
	);
});

describe("Derivation outside any repository", () => {
	let dir = "";
	let file = "";

	beforeAll(async () => {
		dir = await Effect.runPromise(makeTempDir("okfit-profiles-norepo-")); // makeTempDir is an Effect (group A)
		file = join(dir, "note.md");
		await writeFile(file, "---\ntype: Module\ntitle: Note\n---\n\n# Note\n");
	});
	afterAll(async () => {
		await removeDir(dir);
	});

	it.effect("surfaces NotARepositoryError from repoRoot", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(Derivation.generatedAt({ file }));
				assert.instanceOf(error, NotARepositoryError);
				assert.strictEqual(error.cwd, dir);
			}),
		),
	);
});
