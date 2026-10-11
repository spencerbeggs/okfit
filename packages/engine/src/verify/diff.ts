import { Git, GitCommandError } from "@effected/git";
import { DateTime, Effect, Path } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * What changed in a concept file since a human last verified it.
 *
 * `diff` carries the patch from the baseline commit to the working tree (so it
 * includes uncommitted edits); `no-baseline` says why there is none: the
 * verification was never bound (`unbound`), no commit touching the file is at or
 * before the bound time (`no-commit-before`), or the file is outside a git
 * repository (`not-a-repository`).
 *
 * @public
 */
export type ChangeSince =
	| { readonly _tag: "diff"; readonly baseline: string; readonly patch: string }
	| { readonly _tag: "no-baseline"; readonly reason: "unbound" | "no-commit-before" | "not-a-repository" };

/**
 * The patch between the version of `file` a human verified (`at`) and what is
 * on disk now.
 *
 * The baseline is the newest commit touching the file whose committer date is
 * at or before `at`; the patch is `git diff <baseline> -- <file>`.
 *
 * Git access: `@effected/git`'s `Git.log` (scoped to the file, newest first,
 * filtered here on `committedAt`) finds the baseline. `Git.log` has no `until`,
 * and no `Git` member returns a patch (`show` returns a blob, `nameStatus` only
 * paths), so the diff itself runs `git diff` through `effect/process`'s
 * `ChildProcessSpawner`, the same spawner `Git.layer` is built on. Spawn
 * failure maps onto `Git`'s own `GitCommandError`.
 *
 * @param options - `file` is the absolute path of the concept file; `at` is the
 *   time the binding recorded.
 * @public
 */
export const changeSince = Effect.fn("okfit/verify/changeSince")(function* (options: {
	readonly file: string;
	readonly at: DateTime.Utc;
}) {
	const git = yield* Git;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const path = yield* Path.Path;
	const cwd = path.dirname(options.file);
	const name = path.basename(options.file);
	const log = yield* git
		.log(cwd, { paths: [name] })
		.pipe(Effect.catchTag("NotARepositoryError", () => Effect.succeed(undefined)));
	if (log === undefined) return { _tag: "no-baseline", reason: "not-a-repository" } satisfies ChangeSince;
	const baseline = log.find((entry) => DateTime.isLessThanOrEqualTo(entry.committedAt, options.at));
	if (baseline === undefined) return { _tag: "no-baseline", reason: "no-commit-before" } satisfies ChangeSince;
	const args = ["diff", "--no-color", "--no-ext-diff", baseline.sha, "--", name];
	const patch = yield* spawner
		.string(ChildProcess.setCwd(ChildProcess.make("git", args), cwd))
		.pipe(
			Effect.mapError((error) => new GitCommandError({ kind: "failed", args, cwd, stderr: "", detail: error.message })),
		);
	return { _tag: "diff", baseline: baseline.sha.slice(0, 7), patch } satisfies ChangeSince;
});
