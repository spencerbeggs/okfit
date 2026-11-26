import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import type { DescendError, SkippedLink } from "@effected/walker";
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
 * Every file below the root, every symbolic link the walk passed over, and every subdirectory whose listing
 * failed with a non-`NotFound` reason; paths are posix-relative and sorted.
 *
 * @remarks
 * `links` is the walker's own report under `onUnreadable: "record"`: a link to a directory the walk did not enter
 * (`kind: "directory"`, wherever it points) and a link that does not resolve (`kind: "dangling"`). It is raw: the
 * walker reports only links in directories it reads, so a pruned directory, a hidden one and anything under them are
 * absent, but a dangling link is reported whatever its own name. `Bundle.load` decides each by `confineReal`.
 *
 * @public
 */
export interface WalkResult {
	readonly files: ReadonlyArray<string>;
	readonly links: ReadonlyArray<SkippedLink>;
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
		const result = yield* descend(pattern, {
			cwd: options.root,
			maxDepth: options.maxDepth,
			prune: [...options.prune],
			onUnreadable: "record",
		});
		const root = result.unreadable.find((entry) => entry.path === "");
		if (root !== undefined) {
			// W-2: "record" never fails an unreadable root; surface its recorded `PlatformError`.
			return yield* Effect.fail(root.cause);
		}
		const unreadable = result.unreadable
			.map((entry) => ({ path: entry.path, reason: entry.cause.reason._tag }))
			.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		return { files: result.matches, links: result.links, unreadable };
	});
