import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import type { DescendError } from "@effected/walker";
import { descend } from "@effected/walker";
import type { FileSystem, Path, PlatformError } from "effect";
import { Effect } from "effect";

/**
 * Walker's default prune list (`walker/src/Descend.ts:64`), kept for D-8.
 *
 * @public
 */
export const DEFAULT_PRUNE: ReadonlyArray<string> = ["node_modules", ".git"];

/**
 * Walker's default depth (`walker/src/Descend.ts:130`).
 *
 * @public
 */
export const DEFAULT_MAX_DEPTH = 256;

/**
 * Resolved walk options; `Bundle.load` fills the defaults.
 *
 * @public
 */
export interface WalkOptions {
	readonly root: string;
	readonly includeHidden: boolean;
	readonly maxDepth: number;
	readonly prune: ReadonlySet<string>;
}

/**
 * One subdirectory whose listing failed, with the `PlatformError` reason the
 * walker recorded (`PermissionDenied`, `BadResource`, ...); never `NotFound`.
 *
 * @public
 */
export interface UnreadableDirectory {
	readonly path: string;
	readonly reason: string;
}

/**
 * Every file below the root, every directory entry the walk passes and every subdirectory whose listing
 * failed with a non-`NotFound` reason; all posix-relative and sorted by path.
 *
 * @remarks
 * `directories` answers a directory by its RESOLVED kind: a symbolic link to a directory is listed although the
 * walk never enters it, wherever it points; a pruned directory is listed too, since `prune` withholds what lies
 * below a directory, not the directory. A dangling link is in neither list; the walker drops it without a
 * trace. `Bundle.load` checks each listed directory with `confineReal`.
 *
 * @public
 */
export interface WalkResult {
	readonly files: ReadonlyArray<string>;
	readonly directories: ReadonlyArray<string>;
	readonly unreadable: ReadonlyArray<UnreadableDirectory>;
}

/**
 * Core's adapter over `@effected/walker`'s `descend` (api-contract.md section 5): the
 * kit's `onUnreadable: "record"` mode records unreadable subdirectories instead of
 * failing or hiding them (D-9); only depth exhaustion and an unreadable root fail typed
 * (W-1, W-2). `includeHidden` governs the compiled glob's `dot` option (W-3).
 *
 * @public
 */
export const walk = (
	options: WalkOptions,
): Effect.Effect<WalkResult, PlatformError.PlatformError | DescendError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const pattern = yield* GlobPattern.compile("**/*", GlobPatternOptions.make({ dot: options.includeHidden })).pipe(
			Effect.orDie,
		);
		const shared = {
			cwd: options.root,
			maxDepth: options.maxDepth,
			prune: [...options.prune],
			onUnreadable: "record",
		} as const;
		const result = yield* descend(pattern, shared);
		// A second pass lists the directories (a directory link included, by its resolved kind). Its own
		// `unreadable` repeats the first pass's, so only its matches are kept.
		const listed = yield* descend(pattern, { ...shared, match: "directory" });
		const root = result.unreadable.find((entry) => entry.path === "");
		if (root !== undefined) {
			// W-2: "record" never fails an unreadable root; surface its recorded `PlatformError`.
			return yield* Effect.fail(root.cause);
		}
		const unreadable = result.unreadable
			.map((entry) => ({ path: entry.path, reason: entry.cause.reason._tag }))
			.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		return { files: result.matches, directories: listed.matches, unreadable };
	});
