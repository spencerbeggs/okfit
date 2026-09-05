import { NodeServices } from "@effect/platform-node";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
	CONFLICT_COMMIT_COUNT,
	CONFLICT_LOG_ORDER,
	CONFLICT_MESSAGES,
	CONFLICT_PATH,
	CONFLICT_STEPS,
	CONFLICT_TEXTS,
	F4_COMMIT_COUNT,
	F4_ENTRIES,
	F4_LOG_ORDER,
	F4_MESSAGES,
	F4_PATH_RENAMED,
	F4_STEPS,
	F4_TEXTS,
	FIXTURE_AUTHOR_NAME,
} from "../fixtures/history.js";
import type { FixtureRepo } from "../utils/git.js";
import { buildRepo, git, removeDir } from "../utils/git.js";

// The real spawner (effected-git-0-10-0.md section 1.3; PN/dist/NodeServices.d.ts:33).
const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Effect.Effect<A, E> =>
	effect.pipe(Effect.provide(NodeServices.layer));

const lines = (text: string): ReadonlyArray<string> => (text === "" ? [] : text.split("\n"));

describe("F4 history fixture (P-33, P-34)", () => {
	let repo: FixtureRepo;

	beforeAll(async () => {
		repo = await Effect.runPromise(run(buildRepo(F4_STEPS)));
	});

	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("replays seven commits in the expected log order", () =>
		run(
			Effect.gen(function* () {
				const oneline = lines(yield* git(repo.dir, ["log", "--oneline"]));
				assert.strictEqual(oneline.length, F4_COMMIT_COUNT);
				const messages = lines(yield* git(repo.dir, ["log", "--format=%s"]));
				assert.deepStrictEqual(
					messages,
					F4_LOG_ORDER.map((name) => F4_MESSAGES[name]),
				);
				assert.deepStrictEqual(
					F4_LOG_ORDER.map((name) => repo.shas[name]),
					lines(yield* git(repo.dir, ["log", "--format=%H"])),
				);
			}),
		),
	);

	it.effect("ends on a two-parent --no-ff merge of the renamed file", () =>
		run(
			Effect.gen(function* () {
				assert.strictEqual(yield* git(repo.dir, ["rev-parse", "HEAD"]), repo.shas.c6);
				assert.strictEqual(yield* git(repo.dir, ["rev-parse", "HEAD^1"]), repo.shas.c5);
				assert.strictEqual(yield* git(repo.dir, ["rev-parse", "HEAD^2"]), repo.shas.topic);
				assert.deepStrictEqual(lines(yield* git(repo.dir, ["ls-files"])), [F4_PATH_RENAMED]);
				assert.strictEqual(yield* git(repo.dir, ["show", `HEAD:${F4_PATH_RENAMED}`]), F4_TEXTS.c6.trimEnd());
			}),
		),
	);

	it.effect("pins author and committer dates per commit and uses the repo-local identity", () =>
		run(
			Effect.gen(function* () {
				for (const entry of F4_ENTRIES) {
					const sha = repo.shas[entry.name];
					assert.isString(sha);
					const shown = lines(yield* git(repo.dir, ["log", "-1", "--format=%aI%n%cI%n%an%n%ae", sha]));
					assert.deepStrictEqual(shown, [entry.authoredAt, entry.committedAt, entry.authorName, entry.authorEmail]);
				}
				assert.strictEqual(yield* git(repo.dir, ["config", "--local", "user.name"]), FIXTURE_AUTHOR_NAME);
				assert.strictEqual(yield* git(repo.dir, ["config", "--local", "commit.gpgsign"]), "false");
			}),
		),
	);
});

describe("conflict-merge fixture (P-46)", () => {
	let repo: FixtureRepo;

	beforeAll(async () => {
		repo = await Effect.runPromise(run(buildRepo(CONFLICT_STEPS)));
	});

	afterAll(async () => {
		await removeDir(repo.dir);
	});

	it.effect("resolves the conflict into a two-parent merge whose blob differs from both parents", () =>
		run(
			Effect.gen(function* () {
				assert.strictEqual(lines(yield* git(repo.dir, ["log", "--oneline"])).length, CONFLICT_COMMIT_COUNT);
				assert.deepStrictEqual(
					lines(yield* git(repo.dir, ["log", "--format=%s"])),
					CONFLICT_LOG_ORDER.map((name) => CONFLICT_MESSAGES[name]),
				);
				assert.strictEqual(yield* git(repo.dir, ["rev-parse", "HEAD"]), repo.shas.m4);
				assert.strictEqual(yield* git(repo.dir, ["rev-parse", "HEAD^1"]), repo.shas.m3);
				assert.strictEqual(yield* git(repo.dir, ["rev-parse", "HEAD^2"]), repo.shas.m2);
				const head = yield* git(repo.dir, ["show", `HEAD:${CONFLICT_PATH}`]);
				assert.strictEqual(head, CONFLICT_TEXTS.m4.trimEnd());
				assert.notStrictEqual(head, CONFLICT_TEXTS.m3.trimEnd());
				assert.notStrictEqual(head, CONFLICT_TEXTS.m2.trimEnd());
			}),
		),
	);
});
