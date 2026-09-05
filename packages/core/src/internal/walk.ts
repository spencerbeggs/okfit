import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";

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

interface Frame {
	readonly relative: string;
	readonly absolute: string;
	readonly depth: number;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Core's own descent (api-contract.md section 5, deviation 1): mirrors
 * `walker/src/Descend.ts:176-230` but records unreadable subdirectories instead of
 * failing or hiding them (D-9). Only the root listing fails typed.
 *
 * @public
 */
export const walk = (
	options: WalkOptions,
): Effect.Effect<WalkResult, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (!Number.isInteger(options.maxDepth) || options.maxDepth < 0) {
			return yield* Effect.die(
				new Error(`walk: maxDepth must be a non-negative integer, received ${options.maxDepth}`),
			);
		}
		const typeOf = (absolute: string): Effect.Effect<FileSystem.File.Info["type"] | undefined> =>
			fs.stat(absolute).pipe(
				Effect.map((info) => info.type),
				Effect.orElseSucceed(() => undefined),
			);
		const isSymbolicLink = (absolute: string): Effect.Effect<boolean> =>
			fs.readLink(absolute).pipe(
				Effect.map(() => true),
				Effect.orElseSucceed(() => false),
			);
		const files: Array<string> = [];
		const unreadable: Array<string> = [];
		const frames: Array<Frame> = [{ relative: "", absolute: options.root, depth: 0 }];
		for (let head = 0; head < frames.length; head += 1) {
			const frame = frames[head];
			if (frame === undefined) break;
			const entries =
				frame.depth === 0
					? yield* fs.readDirectory(frame.absolute)
					: yield* fs.readDirectory(frame.absolute).pipe(
							Effect.catch((error) => {
								if (error.reason._tag !== "NotFound") unreadable.push(frame.relative);
								return Effect.succeed<Array<string>>([]);
							}),
						);
			for (const entry of entries) {
				if (!options.includeHidden && entry.startsWith(".")) continue;
				const relative = frame.relative === "" ? entry : `${frame.relative}/${entry}`;
				const absolute = path.join(frame.absolute, entry);
				const kind = yield* typeOf(absolute);
				if (kind === "File") {
					files.push(relative);
					continue;
				}
				if (kind !== "Directory" || options.prune.has(entry) || frame.depth + 1 > options.maxDepth) continue;
				if (yield* isSymbolicLink(absolute)) continue;
				frames.push({ relative, absolute, depth: frame.depth + 1 });
			}
		}
		files.sort(compare);
		unreadable.sort(compare);
		return { files, unreadable };
	});
