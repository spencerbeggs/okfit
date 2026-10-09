import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { OkfitConfig } from "@okfit/core";
import { Derivation, GitHistory } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Layer, Option } from "effect";
import { applySyncPlan, planSync, runSync } from "../../src/sync/run.js";

const AT = "2026-06-01T08:00:00Z";

const fakes = (root: string) => {
	const git = Layer.succeed(Git, {
		repoRoot: () => Effect.succeed(root),
		show: (_cwd: string, _ref: string, path: string) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				return Option.some(yield* fs.readFileString(join(root, path)));
			}).pipe(Effect.provide(NodeServices.layer)),
	} as unknown as Git["Service"]);
	const history = Layer.succeed(GitHistory, {
		pathLog: (_root: string, path: string) =>
			Effect.succeed([
				{
					sha: "0123456789abcdef0123456789abcdef01234567",
					path,
					authoredAt: DateTime.makeUnsafe(AT),
					committedAt: DateTime.makeUnsafe(AT),
					authorName: "Author",
					authorEmail: "author@example.com",
				},
			]),
	} as unknown as GitHistory["Service"]);
	return Layer.mergeAll(git, history, NodeServices.layer);
};

/** One concept whose recorded digest is stale, so generated mode must re-stamp it; index.md is missing. */
const seed = async (root: string): Promise<void> => {
	const digest = await Effect.runPromise(
		Derivation.bodyDigest("---\ntype: Module\ntitle: A\n---\n\n# A\n\nOld body.\n").pipe(
			Effect.provide(NodeServices.layer),
		),
	);
	await writeFile(
		join(root, "a.md"),
		`---\ntype: Module\ntitle: A\ngenerated:\n  by: human:ada\n  at: ${AT}\n  body_sha256: ${digest}\n---\n\n# A\n\nNew body.\n`,
	);
};

const options = (root: string, dryRun: boolean) => ({
	bundleRoot: root,
	config: OkfitConfig.DEFAULTS,
	modes: new Set(["generated", "index"] as const),
	dryRun,
});

const snapshot = async (root: string): Promise<Record<string, string>> => ({
	"a.md": await readFile(join(root, "a.md"), "utf8"),
	"index.md": await readFile(join(root, "index.md"), "utf8").catch(() => ""),
});

describe("planSync / applySyncPlan", () => {
	it.effect("planSync writes nothing; applySyncPlan matches runSync on a fresh copy", () =>
		Effect.gen(function* () {
			const one = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-plan-")));
			const two = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-plan-")));
			try {
				yield* Effect.promise(() => seed(one));
				yield* Effect.promise(() => cp(one, two, { recursive: true }));
				const before = yield* Effect.promise(() => snapshot(one));

				const plan = yield* planSync(options(one, false)).pipe(Effect.provide(fakes(one)));
				assert.isTrue(plan.result.dryRun);
				assert.deepStrictEqual(plan.result.generated.written, ["a"]);
				assert.deepStrictEqual(plan.result.index.written, ["index.md"]);
				assert.deepStrictEqual(yield* Effect.promise(() => snapshot(one)), before);

				const applied = yield* applySyncPlan(plan).pipe(Effect.provide(fakes(one)));
				const direct = yield* runSync(options(two, false)).pipe(Effect.provide(fakes(two)));
				assert.isFalse(applied.dryRun);
				assert.deepStrictEqual(applied.generated.written, direct.generated.written);
				assert.deepStrictEqual(applied.index.written, direct.index.written);
				assert.deepStrictEqual(yield* Effect.promise(() => snapshot(one)), yield* Effect.promise(() => snapshot(two)));
				assert.notStrictEqual((yield* Effect.promise(() => snapshot(one)))["a.md"], before["a.md"]);
			} finally {
				yield* Effect.promise(() => rm(one, { recursive: true, force: true }));
				yield* Effect.promise(() => rm(two, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("applySyncPlan refuses a plan whose target changed, writing nothing", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-plan-")));
			try {
				yield* Effect.promise(() => seed(root));
				const plan = yield* planSync(options(root, false)).pipe(Effect.provide(fakes(root)));
				yield* Effect.promise(() => writeFile(join(root, "index.md"), "# edited after the plan\n"));
				const before = yield* Effect.promise(() => snapshot(root));
				const error = yield* applySyncPlan(plan).pipe(Effect.provide(fakes(root)), Effect.flip);
				if (error._tag !== "SyncPlanStaleError") return assert.fail(`unexpected ${error._tag}`);
				assert.deepStrictEqual(error.paths, [join(root, "index.md")]);
				assert.include(error.message, "re-run sync");
				assert.deepStrictEqual(yield* Effect.promise(() => snapshot(root)), before);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});
