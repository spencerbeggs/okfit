import type { LoadedBundle, LoadedConcept } from "@okfit/core";
import { ConceptId } from "@okfit/core";
import { Option } from "effect";

/** Backslashes to forward slashes; the rest of this module treats every path as already resolved. */
const posixOf = (value: string): string => value.split("\\").join("/");

/**
 * The loaded concept at `absolutePath`, if any. `absolutePath` must already sit under
 * `bundle.root` (a real resolved path, never re-resolved here: `@okfit/core`'s own
 * `internal/posixPath.ts` avoids `path.resolve`/`path.relative` on purpose, because both read
 * `process.cwd()`, and this package holds the same line). Strips `bundle.root` as a plain
 * string prefix, then applies the same `ConceptId.fromPath` normalisation `withFallbackRange`
 * uses: `None` for a path outside the bundle, a reserved file (`index.md`, `log.md`), a
 * non-markdown file, or a markdown file that never decoded into a concept.
 *
 * @public
 */
export const conceptFor = (bundle: LoadedBundle, absolutePath: string): Option.Option<LoadedConcept> => {
	const root = posixOf(bundle.root).replace(/\/+$/, "");
	const target = posixOf(absolutePath);
	const prefix = `${root}/`;
	if (!target.startsWith(prefix)) return Option.none();
	const relative = target.slice(prefix.length);
	return Option.flatMap(ConceptId.fromPath(relative), (id) => Option.fromUndefinedOr(bundle.concepts.get(id)));
};
