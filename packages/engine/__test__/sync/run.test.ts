import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { OkfitConfig } from "@okfit/core";
import { Derivation, GitHistory } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Layer, Option } from "effect";
import { runSync } from "../../src/sync/run.js";

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
		`---\ntype: Module\ntitle: ${title}\ngenerated:\n  by: human:ada\n  at: ${AT}\n  body_sha256: ${digest}\n---${body}`,
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
