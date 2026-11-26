import { confineReal } from "@effected/walker";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path } from "effect";
import type { WalkResult } from "./walk.js";

/**
 * One symbolic link the walk did not return as a file or enter as a directory, and why it is refused.
 *
 * @internal
 */
export interface LinkFinding {
	readonly file: string;
	readonly message: string;
}

/**
 * An `lstat` of a listed directory entry that failed.
 *
 * @internal
 */
export interface LinkReadFailure {
	readonly path: string;
	readonly cause: PlatformError.PlatformError;
}

/**
 * Options mirroring the walk's, so a name the walk would not have visited is not examined here either.
 *
 * @internal
 */
export interface LinkScanOptions {
	readonly includeHidden: boolean;
	readonly prune: ReadonlySet<string>;
}

const COULD_NOT_RESOLVE = "could not be resolved, so it cannot be shown to stay inside the bundle root";

/**
 * The links `@effected/walker`'s `descend` neither returns nor enters, as `symlink-escape` findings: a link to a
 * directory that resolves outside the bundle (`descend` lists it as a directory but never enters it), and any link the
 * walk dropped because its resolution fails (a missing target, a loop, a target that cannot be read). The decision is
 * made on the REAL path with `confineReal`, so a link inside the bundle that points at a link leaving it is refused
 * too; a link that stays inside is silent and never walked.
 *
 * @remarks
 * A pruned directory name is fully silent: neither the entry nor anything under it is examined, in either pass. A file
 * link with that name is still checked, because the walk lists it as a file. A hidden name is
 * examined only under `includeHidden`, as the walk itself would. The flat second pass is not a recursive walker and
 * follows no link: it lists each real directory the walk already listed, once, and examines only the names the walk
 * would have visited but did not return.
 *
 * TODO(spencerbeggs/effected#1432): delete this file once `descend` reports the links it does not enter and the
 * dangling ones; `Bundle.load` then maps that report to the same findings.
 *
 * @internal
 */
export const scanLinks = (
	root: string,
	walked: WalkResult,
	options: LinkScanOptions,
): Effect.Effect<ReadonlyArray<LinkFinding>, LinkReadFailure, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const isPruned = (entry: string): boolean => options.prune.has(entry.slice(entry.lastIndexOf("/") + 1));
		// Resolve a link on its real path; `undefined` when it stays inside (or is the bundle root itself).
		const refusal = (relative: string) =>
			confineReal(root, path.join(root, relative)).pipe(
				Effect.match({ onFailure: (error) => error.reason, onSuccess: () => undefined }),
			);
		const findings: Array<LinkFinding> = [];
		const kinds = new Map<string, FileSystem.File.Type>();
		for (const dir of walked.directories) {
			if (isPruned(dir)) continue;
			const info = yield* fs
				.lstat(path.join(root, dir))
				.pipe(Effect.mapError((cause): LinkReadFailure => ({ path: dir, cause })));
			kinds.set(dir, info.type);
			if (info.type !== "SymbolicLink") continue;
			const reason = yield* refusal(dir);
			// `empty`: the link resolves to the bundle root itself, which is inside the bundle (and never walked).
			if (reason === undefined || reason === "empty") continue;
			findings.push({
				file: dir,
				message: `symbolic link to a directory ${reason === "outside" ? "resolves outside the bundle root" : COULD_NOT_RESOLVE}; nothing under it is read or part of the bundle`,
			});
		}
		const known = new Set<string>([...walked.files, ...walked.directories]);
		const visited = (name: string): boolean =>
			!options.prune.has(name) && (options.includeHidden || !name.startsWith("."));
		const dangling: Array<string> = [];
		for (const parent of ["", ...walked.directories]) {
			// Only a real directory is read, never a link. A pruned directory has no recorded kind (the loop above skips
			// it), so it is not read either.
			if (parent !== "" && kinds.get(parent) !== "Directory") continue;
			// A listing failure was already recorded by the walk as `walk-unreadable`.
			const names = yield* fs
				.readDirectory(parent === "" ? root : path.join(root, parent))
				.pipe(Effect.orElseSucceed((): Array<string> => []));
			for (const name of names) {
				const child = parent === "" ? name : `${parent}/${name}`;
				if (!visited(name) || known.has(child)) continue;
				const info = yield* fs.lstat(path.join(root, child)).pipe(Effect.option);
				if (Option.isNone(info) || info.value.type !== "SymbolicLink") continue;
				const reason = yield* refusal(child);
				// `empty` is unreachable here (a link whose stat failed cannot resolve to the root); kept as a defensive guard.
				if (reason !== undefined && reason !== "empty") dangling.push(child);
			}
		}
		for (const child of dangling.sort()) {
			findings.push({
				file: child,
				message: `symbolic link ${COULD_NOT_RESOLVE}; it is not read and not part of the bundle`,
			});
		}
		return findings;
	});
