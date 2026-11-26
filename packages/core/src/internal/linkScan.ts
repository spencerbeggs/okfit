import type { SkippedLink } from "@effected/walker";
import { confineReal } from "@effected/walker";
import type { FileSystem } from "effect";
import { Effect, Path } from "effect";

/**
 * One symbolic link the walk passed over, and why it is refused as `symlink-escape`.
 *
 * @internal
 */
export interface LinkFinding {
	readonly file: string;
	readonly message: string;
}

/**
 * Options mirroring the walk's, so a name the walk would not have visited is not reported here either.
 *
 * @internal
 */
export interface LinkScanOptions {
	readonly includeHidden: boolean;
	readonly prune: ReadonlySet<string>;
}

/** The words a `symlink-escape` message uses for a link that leaves the bundle root; one spelling for every site. */
export const RESOLVES_OUTSIDE = "resolves outside the bundle root";

/** The words a `symlink-escape` message uses for a link that cannot be resolved (dangling, a loop, unreadable). */
export const COULD_NOT_RESOLVE = "could not be resolved, so it cannot be shown to stay inside the bundle root";

const byPath = (a: LinkFinding, b: LinkFinding): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

/**
 * The walker's `links` report as `symlink-escape` findings: a link to a directory that resolves outside the bundle (the
 * walker never enters one, wherever it points), and a link that does not resolve (dangling, whether it named a file or
 * a directory). A directory link is decided on its REAL path with `confineReal`, so a link inside the bundle that points
 * at a link leaving it is refused too; one that stays inside (or is the bundle root itself) is silent and never walked.
 * Directory findings come first, then the unresolvable ones, each sorted by path.
 *
 * @remarks
 * The walker reports links only from directories it reads, so a pruned directory, a hidden one and anything under them
 * are never seen. It reports a dangling link whatever its own name, so a pruned or (without `includeHidden`) hidden name
 * is dropped here to keep Q8: a pruned directory name is fully silent, and a hidden name is reported only with
 * `includeHidden`. A file link with a pruned name is a file match, not a skipped link; `Bundle.load` drops it
 * silently too (never read, never reported), so the prune list silences a name for files and directories alike.
 *
 * @internal
 */
export const scanLinks = (
	root: string,
	links: ReadonlyArray<SkippedLink>,
	options: LinkScanOptions,
): Effect.Effect<ReadonlyArray<LinkFinding>, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const silent = (link: string): boolean => {
			const name = link.slice(link.lastIndexOf("/") + 1);
			return options.prune.has(name) || (!options.includeHidden && name.startsWith("."));
		};
		const directories: Array<LinkFinding> = [];
		const unresolvable: Array<LinkFinding> = [];
		for (const link of links) {
			if (silent(link.path)) continue;
			if (link.kind === "dangling") {
				unresolvable.push({
					file: link.path,
					message: `symbolic link ${COULD_NOT_RESOLVE}; it is not read and not part of the bundle`,
				});
				continue;
			}
			const reason = yield* confineReal(root, path.join(root, link.path)).pipe(
				Effect.match({ onFailure: (error) => error.reason, onSuccess: () => undefined }),
			);
			// `empty`: the link resolves to the bundle root itself, which is inside the bundle (and never walked).

			if (reason === undefined || reason === "empty") continue;
			directories.push({
				file: link.path,
				message: `symbolic link to a directory ${reason === "outside" ? RESOLVES_OUTSIDE : COULD_NOT_RESOLVE}; nothing under it is read or part of the bundle`,
			});
		}
		return [...directories.sort(byPath), ...unresolvable.sort(byPath)];
	});
