import { confineReal } from "@effected/walker";
import type { LoadedBundle } from "@okfit/core";
import { Effect, FileSystem, Path } from "effect";

/**
 * OKF 0.3 section 3.2: a consumer does not follow a symbolic link out of the bundle. Whether the reserved file
 * `relative` (`index.md`, `log.md`) under `root` is a symlink that resolves outside `root`, with no bundle loaded:
 * `lstat` plus `confineReal` (the rule `Bundle.load` applies). A dangling link counts as an escape. A missing
 * file and a regular file are not escapes. The one implementation behind {@link escapesBundle} and `okfit context`.
 *
 * @public
 */
export const escapesRoot = Effect.fn("okfit/confinement/escapesRoot")(function* (root: string, relative: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const target = path.join(root, relative);
	const link = yield* fs.lstat(target).pipe(
		Effect.map((info) => info as FileSystem.File.Info | undefined),
		Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
	);
	if (link === undefined || link.type !== "SymbolicLink") return false;
	return yield* confineReal(root, target).pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }));
});

/**
 * Whether a reserved `index.md` or `log.md` of a loaded bundle escapes it (OKF 0.3 section 3.2). `Bundle.load`
 * records `symlink-escape` on a link that resolves outside the root and on a dangling one, and drops it, so a load
 * diagnostic answers first. {@link escapesRoot} decides every other case, a link that appeared after the load
 * included. A reserved file that escapes is never read and never written, in any mode.
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
