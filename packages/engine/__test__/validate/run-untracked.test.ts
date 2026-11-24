import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { OkfitConfig } from "@okfit/core";
import { GitHistory } from "@okfit/profiles";
import { DateTime, Effect, Layer, Option } from "effect";
import { BundleSession } from "../../src/session/BundleSession.js";
import { run } from "../../src/validate/run.js";
import { TestPlatform } from "../utils/platform.js";

// #279 wiring: `run` raises resource-ignored / resource-untracked in a real
// repository, `skipProvenance` and `skipUntracked` each suppress it, and the
// language server's BundleSession never runs it. The lint itself is covered by
// untracked.test.ts; this suite proves it is actually connected.

const platform = Layer.mergeAll(Git.layer, GitHistory.layerTest({})).pipe(Layer.provideMerge(TestPlatform));
const now = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
// Drift lint off: this suite scripts no git history.
const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, { extensions: {}, lint: { generated_at_drift: "off" } });

const sh = (cwd: string, ...args: Array<string>): void => {
	execFileSync("git", args, {
		cwd,
		stdio: "ignore",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_SYSTEM: "/dev/null",
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@example.com",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@example.com",
		},
	});
};

const withRepo = <A, E, R>(body: (bundleRoot: string) => Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Effect.promise(async () => {
			const repo = await realpath(await mkdtemp(join(tmpdir(), "okfit-run-untracked-")));
			sh(repo, "init", "-q");
			await mkdir(join(repo, "okf"), { recursive: true });
			await writeFile(join(repo, ".gitignore"), "secret.md\n");
			await writeFile(join(repo, "secret.md"), "x\n");
			await writeFile(join(repo, "new.md"), "x\n");
			await writeFile(
				join(repo, "okf", "thing.md"),
				"---\ntype: Module\nsources:\n  - resource: ../secret.md\n  - resource: ../new.md\n---\n\n# Thing\n\nBody text.\n",
			);
			await writeFile(join(repo, "okf", "index.md"), "# Index\n\n- [Thing](thing.md)\n");
			sh(repo, "add", ".gitignore", "okf");
			sh(repo, "commit", "-qm", "init");
			return repo;
		}),
		(repo) => body(join(repo, "okf")),
		(repo) => Effect.promise(() => rm(repo, { recursive: true, force: true })),
	);

const codes = (lint: ReadonlyArray<{ readonly code: string }>) => lint.map((d) => d.code).sort();

describe("run — untracked resource lint wiring (issue #279)", () => {
	it.effect("reports resource-ignored and resource-untracked in a real repository", () =>
		withRepo((root) =>
			Effect.gen(function* () {
				const result = yield* run({ root, projectRoot: dirname(root), config, profile: Option.none(), now });
				assert.deepStrictEqual(codes(result.report.lint), ["resource-ignored", "resource-untracked"]);
			}),
		).pipe(Effect.provide(platform)),
	);

	it.effect("skipProvenance: true suppresses it", () =>
		withRepo((root) =>
			Effect.gen(function* () {
				const result = yield* run({
					root,
					projectRoot: dirname(root),
					config,
					profile: Option.none(),
					now,
					skipProvenance: true,
				});
				assert.deepStrictEqual(codes(result.report.lint), []);
			}),
		).pipe(Effect.provide(platform)),
	);

	it.effect("skipUntracked: true suppresses it", () =>
		withRepo((root) =>
			Effect.gen(function* () {
				const result = yield* run({
					root,
					projectRoot: dirname(root),
					config,
					profile: Option.none(),
					now,
					skipUntracked: true,
				});
				assert.deepStrictEqual(codes(result.report.lint), []);
			}),
		).pipe(Effect.provide(platform)),
	);

	it.effect("BundleSession does not run it, even on a full revalidate", () =>
		withRepo((root) =>
			Effect.gen(function* () {
				const session = yield* BundleSession.make({ root, projectRoot: dirname(root), config, profile: Option.none() });
				const result = yield* session.revalidate({ now, tier: "full" });
				assert.deepStrictEqual(
					[...result.changed.values()].flat().map((d) => d.code),
					[],
				);
				// Positive control: the same repo does report through run().
				const direct = yield* run({ root, projectRoot: dirname(root), config, profile: Option.none(), now });
				assert.isAbove(direct.report.lint.length, 0);
			}),
		).pipe(Effect.provide(platform)),
	);
});
