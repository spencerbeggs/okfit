import { confineReal } from "@effected/walker";
import type { LoadedBundle } from "@okfit/core";
import { Effect, FileSystem, Path } from "effect";

/**
 * OKF 0.3 section 3.2: a consumer does not follow a symbolic link out of the bundle. Whether the file `relative`
 * under `root` leaves `root` through a symbolic link, with no bundle loaded: a missing file is not an escape;
 * otherwise `confineReal` answers on the whole path, so a link at the file itself or at any directory above it
 * that resolves outside `root`, or that dangles, is an escape (the rule `Bundle.load` applies). A regular file
 * under real directories, and a link that stays inside `root`, are not. The one implementation behind
 * {@link escapesBundle}, `okfit context` and the MCP concept resources.
 *
 * @public
 */
export const escapesRoot = Effect.fn("okfit/confinement/escapesRoot")(function* (root: string, relative: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const target = path.join(root, relative);
	const present = yield* fs.lstat(target).pipe(
		Effect.as(true),
		Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
	);
	if (!present) return false;
	return yield* confineReal(root, target).pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }));
});

/**
 * Whether a reserved `index.md` or `log.md` of a loaded bundle escapes it (OKF 0.3 section 3.2). `Bundle.load`
 * records `symlink-escape` on a link that resolves outside the root and on a dangling one, and drops it, so a load
 * diagnostic answers first. {@link escapesRoot} decides every other case, a link that appeared after the load
 * included, at the file or at a directory above it. A reserved file that escapes is never read and never written, in any mode.
 *
 * @public
 */
export const escapesBundle = Effect.fn("okfit/confinement/escapesBundle")(function* (
	bundle: LoadedBundle,
	relative: string,
) {
	if (bundle.diagnostics.some((entry) => entry.code === "symlink-escape" && entry.file === relative)) return true;
	return yield* escapesRoot(bundle.root, relative);
});
