import { Git, UnknownRefError } from "@effected/git";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { GitHistory, PathHistoryEntry } from "../../src/GitHistory.js";
import type { HistoryCommit } from "../fixtures/history.js";
import { F4_PATH_RENAMED } from "../fixtures/history.js";

/** One recorded `configGet` call: the key and the options object exactly as passed (`undefined` means merged scope, P-15). */
export interface ConfigGetCall {
	readonly key: string;
	readonly options: unknown;
}

/**
 * A `Git` double answering `configGet` from `values` (a missing key is `Option.none`) and recording every
 * call into `calls`; every other member dies (GIT/index.d.ts:1958-1970).
 */
export const identityGit = (
	values: Readonly<Record<string, string>>,
	calls: Array<ConfigGetCall> = [],
): Layer.Layer<Git> =>
	Git.layerTest({
		configGet: (_cwd, key, options) => {
			calls.push({ key, options });
			const value = values[key];
			return Effect.succeed(value === undefined ? Option.none<string>() : Option.some(value));
		},
	});

const decodeEntry = Schema.decodeUnknownSync(PathHistoryEntry);

/** A `PathHistoryEntry` for one fixture commit; the ISO strings go through core's `Timestamp` codec (P-4). */
export const entryOf = (commit: HistoryCommit): PathHistoryEntry =>
	decodeEntry({
		sha: commit.sha,
		authoredAt: commit.authoredAt,
		committedAt: commit.committedAt,
		authorName: commit.authorName,
		authorEmail: commit.authorEmail,
		path: commit.path,
	});

/** `commits` is already newest first (`F4_ENTRIES` is `F4_LOG_ORDER` mapped, group A); this only decodes. */
export const entriesOf = (commits: ReadonlyArray<HistoryCommit>): ReadonlyArray<PathHistoryEntry> =>
	commits.map(entryOf);

/** `${sha}:${path}` to blob text, the shape the `show` double answers from. */
export const blobsOf = (commits: ReadonlyArray<HistoryCommit>): Readonly<Record<string, string>> =>
	Object.fromEntries(commits.map((commit) => [`${commit.sha}:${commit.path}`, commit.text]));

export const ROOT = "/repo";
export const REL = F4_PATH_RENAMED;
export const FILE = `${ROOT}/${F4_PATH_RENAMED}`;

export interface WorldOptions {
	/** What `Git.repoRoot` answers; default {@link ROOT}. */
	readonly root?: string;
	/** The absolute file passed to `generatedAt`; default {@link FILE}. */
	readonly file?: string;
	/** The repo-relative posix path `pathLog` and `show(HEAD)` must be asked for; default {@link REL}. */
	readonly rel?: string;
	/** `fs.realPath` answers; a path not listed resolves to itself. */
	readonly realPaths?: Readonly<Record<string, string>>;
	/** What `fs.readFileString(file)` returns. */
	readonly worktree: string;
	/** What `Git.show(root, "HEAD", rel)` answers; `"unborn"` fails with `UnknownRefError` (P-11). */
	readonly head: Option.Option<string> | "unborn";
	/** `Git.show(root, sha, path)` answers keyed `${sha}:${path}`; a missing key is `Option.none`. */
	readonly blobs?: Readonly<Record<string, string>>;
	/** `GitHistory.pathLog(root, rel)` answer, newest first. Omitted: `pathLog` is unscripted and DIES if called (decision 10). */
	readonly history?: ReadonlyArray<PathHistoryEntry>;
	/** The `Path` implementation; default posix `Path.layer`. */
	readonly path?: Layer.Layer<Path.Path>;
}

/**
 * Everything `Derivation.generatedAt` requires (P-30), scripted: `Git.layerTest({ repoRoot, show })`,
 * `GitHistory.layerTest(history === undefined ? {} : { [rel]: history })`,
 * `FileSystem.layerNoop({ readFileString, realPath })` (EF/FileSystem.ts:954) and `Path.layer` (EF/Path.ts:867).
 * Any other `Git`/`GitHistory` call or any other file read dies, so a test proves it touches nothing it did not script.
 */
export const world = (options: WorldOptions): Layer.Layer<Git | GitHistory | FileSystem.FileSystem | Path.Path> => {
	const root = options.root ?? ROOT;
	const file = options.file ?? FILE;
	const rel = options.rel ?? REL;
	const realPaths = options.realPaths ?? {};
	const blobs = options.blobs ?? {};
	const git = Git.layerTest({
		repoRoot: () => Effect.succeed(root),
		show: (_cwd, ref, path): Effect.Effect<Option.Option<string>, UnknownRefError> => {
			if (ref === "HEAD") {
				return options.head === "unborn"
					? Effect.fail(new UnknownRefError({ ref: "HEAD", cwd: root }))
					: Effect.succeed(options.head);
			}
			const text = blobs[`${ref}:${path}`];
			return Effect.succeed(text === undefined ? Option.none<string>() : Option.some(text));
		},
	});
	const history = GitHistory.layerTest(options.history === undefined ? {} : { [rel]: options.history });
	const fs = FileSystem.layerNoop({
		readFileString: (path) =>
			path === file ? Effect.succeed(options.worktree) : Effect.die(new Error(`unexpected readFileString(${path})`)),
		realPath: (path) => Effect.succeed(realPaths[path] ?? path),
	});
	return Layer.mergeAll(git, history, fs, options.path ?? Path.layer);
};

const toPosix = (path: string): string => path.split("\\").join("/");
const toWindows = (path: string): string => path.split("/").join("\\");

/**
 * A `Path` whose `sep` is `\` and whose `dirname`/`relative` speak backslashes, layered over the posix
 * implementation (EF/Path.ts:867; `Layer.effect` EF/Layer.ts:1014, `Layer.provide` :1432). Proves P-39's
 * separator conversion without a Windows host.
 */
export const windowsPath: Layer.Layer<Path.Path> = Layer.effect(
	Path.Path,
	Effect.gen(function* () {
		const posix = yield* Path.Path;
		return {
			...posix,
			sep: "\\",
			dirname: (path: string) => toWindows(posix.dirname(toPosix(path))),
			relative: (from: string, to: string) => toWindows(posix.relative(toPosix(from), toPosix(to))),
		};
	}),
).pipe(Layer.provide(Path.layer));
