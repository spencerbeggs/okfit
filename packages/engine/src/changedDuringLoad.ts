import type { LoadedBundle } from "@okfit/core";
import { ConceptId } from "@okfit/core";

/**
 * The files `Bundle.load` left out because they changed while they were read (the `read-changed` diagnostic): an
 * editor's atomic save, or a rename, landing under the load. Such a file is missing from the bundle, so a writer that
 * derives from the whole bundle (an index, a log, a rewrite of every link) would be silently incomplete. Bundle-relative.
 *
 * @internal
 */
export const changedFiles = (bundle: LoadedBundle): ReadonlyArray<string> =>
	bundle.diagnostics.filter((entry) => entry.code === "read-changed").map((entry) => entry.file);

/**
 * The concept ids among {@link changedFiles}: every `.md` that is not a reserved `index.md` or `log.md`.
 *
 * @internal
 */
export const changedConceptIds = (bundle: LoadedBundle): ReadonlyArray<string> =>
	changedFiles(bundle)
		.filter((file) => file.endsWith(".md") && !ConceptId.isReservedFile(file))
		.map((file) => file.slice(0, -3));

/**
 * Every directory a changed file sits in or under, as index keys (`""` for the bundle root): the indexes whose content
 * the missing file would change.
 *
 * @internal
 */
export const changedDirectories = (bundle: LoadedBundle): ReadonlySet<string> => {
	const directories = new Set<string>();
	for (const file of changedFiles(bundle)) {
		for (let at = file.lastIndexOf("/"); ; at = file.lastIndexOf("/", at - 1)) {
			directories.add(at < 0 ? "" : file.slice(0, at));
			if (at < 0) break;
		}
	}
	return directories;
};
