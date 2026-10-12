import type { Path } from "effect";

/**
 * The posix path of `absolute` relative to `root` (`""` for the root itself), or `undefined` when it
 * lies outside. Only a `..` segment escapes: a file named `..draft.md` is inside.
 *
 * @internal
 */
export const relativeInside = (path: Path.Path, root: string, absolute: string): string | undefined => {
	const relative = path.relative(root, absolute);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
	return relative.split(path.sep).join("/");
};
