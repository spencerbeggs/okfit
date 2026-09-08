import type { GitCommandError, NotARepositoryError } from "@effected/git"; // GIT/index.d.ts:800, :778
import { Git } from "@effected/git"; // GIT/index.d.ts:65, :2054; log :1700
import { Timestamp } from "@okfit/core"; // CORE/Timestamp.ts:19
import { Context, Effect, Layer, Schema } from "effect"; // EF/index.ts:112, :147, :152, :292, :522
import type { ChildProcessSpawner } from "effect/unstable/process"; // EF/unstable/process/index.ts:15

/**
 * One record of the path log, newest first (P-3, P-5): the commit, both dates decoded through core's
 * `Timestamp` (`%aI` / `%cI`, strict ISO with an offset; the `Type` is `DateTime.Utc`, P-4), the author
 * identity, and the repository-relative posix path the blob had at that commit (the `--name-only` line).
 * @public
 */
export class PathHistoryEntry extends Schema.Class<PathHistoryEntry>("PathHistoryEntry")({
	sha: Schema.String,
	authoredAt: Timestamp,
	committedAt: Timestamp,
	authorName: Schema.String,
	authorEmail: Schema.String,
	path: Schema.String,
}) {}

/**
 * Profiles' own spawn failure, shaped like `@effected/git`'s `GitCommandError` (P-12). Raised by
 * `GitHistory.layer` for any `GitCommandError` `Git.log` produces, including the one `Git.log`
 * itself synthesizes when its own spawn timeout expires.
 * @public
 */
export class GitHistoryError extends Schema.TaggedError<GitHistoryError>()("GitHistoryError", {
	/** The argv without the leading `git`. */
	args: Schema.Array(Schema.String),
	/** The working directory the command ran in. */
	cwd: Schema.String,
	/** git's exit code; absent when git never produced one. */
	exitCode: Schema.optionalKey(Schema.Number),
	/** git's stderr, captured under `LC_ALL=C`. */
	stderr: Schema.String,
	/** Spawn failure text, `timed out after 30s`, or `Git.log`'s own absorbed-failure detail. */
	detail: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		const exit = this.exitCode === undefined ? "" : ` (exit ${this.exitCode})`;
		return `git ${this.args.join(" ")}${exit} in ${this.cwd}: ${this.detail ?? this.stderr}`;
	}
}

/**
 * Options for `pathLog`; `limit` becomes `Git.log`'s `--max-count=<n>` (P-3, P-8).
 * @public
 */
export interface PathLogOptions {
	readonly limit?: number;
}

/**
 * The service shape. `cwd` is any directory inside the repository; `path` is relative to `cwd` (git
 * pathspec semantics). The result is newest first, and empty when no commit contains the path or HEAD is
 * unborn (P-11).
 * @public
 */
export interface GitHistoryShape {
	readonly pathLog: (
		cwd: string,
		path: string,
		options?: PathLogOptions,
	) => Effect.Effect<ReadonlyArray<PathHistoryEntry>, GitHistoryError | NotARepositoryError>;
}

// Maps @effected/git's GitCommandError onto this package's own error shape (P-12): the redacted argv,
// cwd, exit code and stderr carry straight across; `detail` carries across only when Git.log itself set
// it (an absorbed spawn PlatformError, its own 30 s timeout, or an unparseable-log defect it turned into
// a "failed" kind).
const toGitHistoryError = (cwd: string, error: GitCommandError): GitHistoryError =>
	new GitHistoryError({
		args: error.args,
		cwd,
		...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
		stderr: error.stderr,
		...(error.detail === undefined ? {} : { detail: error.detail }),
	});

// The live shape. `git` is resolved once by `layer`, so every member's R is never (GIT/index.d.ts:2055 precedent).
// Exported (but not from the package's barrel, `src/index.ts`) so `GitHistory.test.ts` can unit-test the
// `Git.log` -> `GitHistoryShape` mapping directly over `Git.layerTest`/`Git.makeTest` overrides (G-4),
// the same "internal, not barrel-exported" posture `internal/pathLog.ts` had before this module started
// delegating to `Git.log`.
export const make = (git: Git["Service"]): GitHistoryShape => ({
	pathLog: (cwd, path, options) =>
		Effect.gen(function* () {
			const entries = yield* git
				.log(cwd, {
					paths: [path],
					follow: true,
					firstParentDiffMerges: true,
					...(options?.limit === undefined ? {} : { limit: options.limit }),
				})
				.pipe(
					Effect.catchTag("GitCommandError", (error) => Effect.fail(toGitHistoryError(cwd, error))), // EF/Effect.ts catchTag
				);
			// An entry with EMPTY `paths` is a merge TREESAME to its first parent that `firstParentDiffMerges`
			// still lists; the old hand-rolled parser never produced a record for such a merge, so drop it here.
			return entries
				.filter((entry) => entry.paths.length > 0)
				.map((entry) => {
					const [path] = entry.paths; // non-empty per the filter above
					return PathHistoryEntry.make({
						sha: entry.sha,
						authoredAt: entry.authoredAt,
						committedAt: entry.committedAt,
						authorName: entry.authorName,
						authorEmail: entry.authorEmail,
						path: path ?? "",
					});
				});
		}),
});

const notScripted = (path: string): Effect.Effect<never> =>
	Effect.die(new Error(`GitHistory.makeTest: pathLog(${path}) was called but not scripted`)); // EF/Effect.ts:1606

/**
 * A path-scoped, date-bearing log: `Git.log` reads the whole repository history, and this adapter scopes
 * it to one path (`--follow`, `--diff-merges=first-parent`) and decodes it into `PathHistoryEntry`.
 * Delegates to `Git.log` as of `@effected/git` 0.12.0 (P-1, spec deviation retired).
 * @public
 */
export class GitHistory extends Context.Service<GitHistory, GitHistoryShape>()("@okfit/profiles/GitHistory") {
	/**
	 * Live layer (P-1, P-5, P-11): one `Git.log` call per `pathLog`, resolved once at construction like
	 * `Git.layer` itself, so every member's `R` is `never`. `Git.log` already degrades an unborn `HEAD` and
	 * an unmatched pathspec to the empty array and classifies `not a git repository` as `NotARepositoryError`
	 * (both pass through unchanged); every other failure becomes `GitHistoryError`, including the one
	 * `Git.log` itself produces when its own 30 s spawn timeout expires (`@effected/git`'s `GIT_TIMEOUT`
	 * ceiling, not this adapter's) — `Git.log` never lets a bare `Cause.TimeoutError` escape. The CLI
	 * provides `ChildProcessSpawner` through `NodeServices.layer` (P-30).
	 */
	static readonly layer: Layer.Layer<GitHistory, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
		// EF/Layer.ts:1014
		GitHistory,
		Effect.gen(function* () {
			const git = yield* Git;
			return make(git);
		}),
	).pipe(Layer.provide(Git.layer)); // EF/Layer.ts; Git.layer GIT/index.d.ts:2056

	/**
	 * Scripted double (P-32): responses keyed by the `path` argument exactly as passed to `pathLog`. A call
	 * whose path has no entry DIES with `GitHistory.makeTest: pathLog(<path>) was called but not scripted`,
	 * mirroring `Git.makeTest`; `limit` is honoured by slicing. Models none of the live semantics.
	 */
	static readonly makeTest = (script: Readonly<Record<string, ReadonlyArray<PathHistoryEntry>>>): GitHistoryShape => ({
		pathLog: (_cwd, path, options) => {
			if (!Object.hasOwn(script, path)) return notScripted(path);
			const entries = script[path] ?? [];
			return Effect.succeed(options?.limit === undefined ? entries : entries.slice(0, options.limit));
		},
	});

	/**
	 * `Layer.succeed(GitHistory, GitHistory.makeTest(script))`. Mints a fresh layer per call: bind it to a
	 * `const`, since layers memoize by reference.
	 */
	static readonly layerTest = (
		script: Readonly<Record<string, ReadonlyArray<PathHistoryEntry>>>,
	): Layer.Layer<GitHistory> => Layer.succeed(GitHistory, GitHistory.makeTest(script)); // EF/Layer.ts:807
}
