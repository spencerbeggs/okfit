import { NotARepositoryError } from "@effected/git"; // GIT/index.d.ts:778-790; re-used, never re-declared (P-11, P-12)
import { Timestamp } from "@okfit/core"; // CORE/Timestamp.ts:19
import type { PlatformError } from "effect"; // EF/index.ts:402
import { Context, Duration, Effect, Layer, Result, Schema } from "effect"; // EF/index.ts:112, :147, :152, :292, :502, :522
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"; // EF/unstable/process/index.ts:10, :15
import { classifyFailure, parsePathLog, pathLogArgs } from "./internal/pathLog.js";
import { runCollected } from "./internal/spawn.js";

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

// P-1 discipline copied from @effected/git: LC_ALL=C keeps stderr classifiable, GIT_TERMINAL_PROMPT=0 keeps a
// credential prompt from ever hanging the run; extendEnv: true keeps PATH (EF/unstable/process/ChildProcess.ts:393, :405).
const GIT_ENV = { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" } as const;
const GIT_TIMEOUT = Duration.seconds(30); // EF/Duration.ts:707
const decodeEntries = Schema.decodeUnknownSync(Schema.Array(PathHistoryEntry)); // EF/Schema.ts:1907, :4621

// Text for a spawn that never produced an exit code, as Git.detail words it (effected-git-0-10-0.md section 3.1).
const describeSpawnFailure = (error: PlatformError.PlatformError): string =>
	error.reason._tag === "NotFound" // EF/PlatformError.ts:157 (reason), :75-87 (tags)
		? "git is not installed (or the working directory does not exist)"
		: `spawn failed: ${error.reason._tag}: ${error.message}`;

// The live shape. `spawner` is resolved once by `layer`, so every member's R is never (GIT/index.d.ts:1956 precedent).
const make = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]): GitHistoryShape => ({
	pathLog: (cwd, path, options) =>
		Effect.gen(function* () {
			const args = pathLogArgs(path, options?.limit);
			// EF/unstable/process/ChildProcess.ts:603 (make), :792 (setCwd)
			const command = ChildProcess.setCwd(ChildProcess.make("git", args, { env: GIT_ENV, extendEnv: true }), cwd);
			const collected = yield* runCollected(command).pipe(
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner), // EF/Effect.ts:6278
				Effect.mapError((error) => new GitHistoryError({ args, cwd, stderr: "", detail: describeSpawnFailure(error) })), // :3550
				Effect.timeoutOrElse({
					// :4601
					duration: GIT_TIMEOUT,
					orElse: () => Effect.fail(new GitHistoryError({ args, cwd, stderr: "", detail: "timed out after 30s" })),
				}),
			);
			if (collected.exitCode !== 0) {
				switch (classifyFailure(collected.stderr)) {
					case "notARepository":
						return yield* Effect.fail(new NotARepositoryError({ cwd }));
					case "unborn":
						return []; // P-11: an unborn HEAD is an empty history
					case "failed":
						return yield* Effect.fail(
							new GitHistoryError({ args, cwd, exitCode: collected.exitCode, stderr: collected.stderr }),
						);
				}
			}
			const parsed = parsePathLog(collected.stdout);
			if (Result.isFailure(parsed)) {
				// EF/Result.ts:565
				return yield* Effect.fail(
					new GitHistoryError({ args, cwd, exitCode: 0, stderr: collected.stderr, detail: parsed.failure }),
				);
			}
			return yield* Effect.try({
				// EF/Effect.ts:1608
				try: () => decodeEntries(parsed.success),
				catch: (error) =>
					new GitHistoryError({
						args,
						cwd,
						exitCode: 0,
						stderr: collected.stderr,
						detail: error instanceof Error ? error.message : String(error),
					}),
			});
		}),
});

const notScripted = (path: string): Effect.Effect<never> =>
	Effect.die(new Error(`GitHistory.makeTest: pathLog(${path}) was called but not scripted`)); // EF/Effect.ts:1606

/**
 * The one git read `@effected/git` 0.10.0 lacks: a path-scoped, date-bearing log (P-1, spec deviation).
 * When upstream ships an equivalent, `layer` becomes an adapter and this surface does not change.
 * @public
 */
export class GitHistory extends Context.Service<GitHistory, GitHistoryShape>()("@okfit/profiles/GitHistory") {
	/**
	 * Live layer (P-1, P-5, P-11): one `git log` spawn per call through `ChildProcessSpawner`, resolved once
	 * at construction like `Git.layer`, so every member's `R` is `never`. Classification, in order: a spawn
	 * `PlatformError` -> `GitHistoryError { detail }`; exit 0 -> parse; stderr `not a git repository` ->
	 * `NotARepositoryError`; `does not have any commits yet` / `unknown revision` -> `[]`; otherwise
	 * `GitHistoryError { exitCode, stderr }`. Malformed stdout and a date `Timestamp` rejects are
	 * `GitHistoryError { detail }`. The CLI provides `ChildProcessSpawner` through `NodeServices.layer` (P-30).
	 */
	static readonly layer: Layer.Layer<GitHistory, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
		// EF/Layer.ts:1014
		GitHistory,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			return make(spawner);
		}),
	);

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
