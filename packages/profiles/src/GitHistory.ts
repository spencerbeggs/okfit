import type { NotARepositoryError } from "@effected/git"; // GIT/index.d.ts:778-790; re-used, never re-declared (P-11, P-12)
import { Timestamp } from "@okfit/core"; // CORE/Timestamp.ts:19
import { Context, Effect, Layer, Schema } from "effect"; // EF/index.ts:112, :152, :292, :522

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
 * `GitHistory.layer` for an unclassified non-zero exit, a spawn `PlatformError`, the 30 s timeout,
 * malformed stdout, or a date core's `Timestamp` rejects.
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
	/** Spawn failure text, `timed out after 30s`, `malformed log output`, or a `Timestamp` decode issue. */
	detail: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		const exit = this.exitCode === undefined ? "" : ` (exit ${this.exitCode})`;
		return `git ${this.args.join(" ")}${exit} in ${this.cwd}: ${this.detail ?? this.stderr}`;
	}
}

/**
 * Options for `pathLog`; `limit` becomes `--max-count=<n>` (P-3, P-8).
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

const notScripted = (path: string): Effect.Effect<never> =>
	Effect.die(new Error(`GitHistory.makeTest: pathLog(${path}) was called but not scripted`)); // EF/Effect.ts:1606

/**
 * The one git read `@effected/git` 0.10.0 lacks: a path-scoped, date-bearing log (P-1, spec deviation).
 * When upstream ships an equivalent, `layer` becomes an adapter and this surface does not change.
 * @public
 */
export class GitHistory extends Context.Service<GitHistory, GitHistoryShape>()("@okfit/profiles/GitHistory") {
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
