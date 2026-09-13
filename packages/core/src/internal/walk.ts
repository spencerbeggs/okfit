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
 * Every file below the root and every subdirectory whose listing failed with a
 * non-`NotFound` reason; both posix-relative and sorted.
 *
 * @public
 */
export interface WalkResult {
	readonly files: ReadonlyArray<string>;
	readonly unreadable: ReadonlyArray<string>;
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
		if (!Number.isInteger(options.maxDepth) || options.maxDepth < 1) {
			return yield* Effect.die(new Error(`walk: maxDepth must be a positive integer, received ${options.maxDepth}`));
		}
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
		const unreadable = result.unreadable.map((entry) => entry.path).sort();
		return { files: result.matches, unreadable };
	});
