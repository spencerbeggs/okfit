import type { ConfigResolver } from "@effected/config-file";
import { Walker } from "@effected/walker";
import type { FileSystem } from "effect";
import { Effect, Path } from "effect";

/** C-1's three per-directory candidates, in precedence order. */
const CANDIDATE_NAMES = [".okfit.toml", "okfit.toml", ".config/okfit.toml"] as const;

/**
 * The project tier: at every directory from `cwd` up to the filesystem root,
 * the three C-1 names in order; the first hit anywhere wins and the walk
 * stops. Hand-rolled because `ConfigResolver.upwardWalk` varies subpaths, not
 * filenames (C-7).
 *
 * @remarks
 * `ConfigFile.discover` exhausts one resolver before starting the next, so
 * three `upwardWalk` entries would let a parent's `.okfit.toml` beat a
 * child's `okfit.toml` — the ordering C-1 rejects. `Walker.findUpward`
 * flattens the candidates per directory and scans once, which is exactly the
 * per-directory precedence required. Delete this module once `upwardWalk`
 * grows a per-directory candidate list upstream.
 *
 * @public
 */
export const projectResolver = (options: {
	readonly cwd: string;
}): ConfigResolver<FileSystem.FileSystem | Path.Path> => ({
	name: "project",
	resolve: Effect.gen(function* () {
		const path = yield* Path.Path;
		// C-2: ascend to the filesystem root. No `stopAt`, no `.git` probe.
		const dirs = yield* Walker.ascend(options.cwd);
		return yield* Walker.findUpward(dirs, (dir) => CANDIDATE_NAMES.map((name) => path.join(dir, name)));
	}),
});
