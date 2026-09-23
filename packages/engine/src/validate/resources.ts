import type { LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Diagnostic, DiagnosticRange, OkfitConfig as OkfitConfigNS } from "@okfit/core";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";

/** A `resource`/`sources[].resource` value that names a URL, not a bundle-relative path (D-24). */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Glob metacharacters that mark a value as a descriptor pattern, not a literal path. */
const GLOB_RE = /[*?[{]/;

/**
 * True when `value` is a descriptor (a URL, a scope description, or a glob
 * pattern) rather than a literal bundle-relative path — D-24 leaves
 * `Source.resource` untyped for exactly this reason: "a URL, a bundle path or
 * a scope descriptor; never resolved here". Anything with a URL scheme
 * (`https:`, `git:`, …) or a bare `://`, anything containing whitespace (a
 * prose description like "the git history"), and anything containing a glob
 * metacharacter (`src/**`) is a descriptor and is skipped, never resolved
 * against the filesystem.
 */
const isDescriptor = (value: string): boolean =>
	SCHEME_RE.test(value) || value.includes("://") || /\s/.test(value) || GLOB_RE.test(value);

/** Strips a trailing `#fragment` or `?query` suffix before filesystem resolution. */
const stripSuffix = (value: string): string => {
	const at = value.search(/[?#]/);
	return at === -1 ? value : value.slice(0, at);
};

/** One `resource`/`sources[i].resource` value, paired with the frontmatter path that names it. */
interface ResourceValue {
	readonly value: string;
	readonly path: ReadonlyArray<string | number>;
}

/** Every `resource` value on a concept, each with its own frontmatter path: the top-level field, then each source's. */
const resourceValuesOf = (concept: LoadedConcept): Array<ResourceValue> => {
	const values: Array<ResourceValue> = [];
	if (concept.frontmatter.resource !== undefined)
		values.push({ value: concept.frontmatter.resource, path: ["resource"] });
	concept.frontmatter.sources?.forEach((source, index) => {
		values.push({ value: source.resource, path: ["sources", index, "resource"] });
	});
	return values;
};

/**
 * D-24's `resource`/`sources[].resource` value resolves to nothing in the
 * bundle for every non-descriptor value on every concept (issue #106). A
 * `resource` is a descriptor (a URL, a scope description, or a glob
 * pattern) or a literal path resolved in D-23 order: relative to the
 * concept's own directory, then (for a bare path) relative to the bundle
 * root, or with a leading `/` relative to the bundle root only; only the
 * latter is checked against the filesystem. Ranges at the offending value
 * (phase 4 decision 2, via `DiagnosticRange.forFrontmatterPath`) using the
 * `["resource"]` or `["sources", index, "resource"]` path the value came
 * from. Total over severity (mirrors `Provenance.lint`'s S-28 posture):
 * returns `[]`, touching neither `FileSystem` nor `Path`, the moment
 * `OkfitConfig.severityFor(config, "source-resource-missing")` is `"off"`.
 *
 * @public
 */
export const lintResources = (
	bundle: LoadedBundle,
	config: OkfitConfig,
): Effect.Effect<ReadonlyArray<Diagnostic>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const severity = OkfitConfigNS.severityFor(config, "source-resource-missing");
		if (severity === "off") return [];
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const diagnostics: Array<Diagnostic> = [];
		for (const [, concept] of bundle.concepts) {
			for (const { value, path: fieldPath } of resourceValuesOf(concept)) {
				if (isDescriptor(value)) continue;
				const stripped = stripSuffix(value);
				// D-23 order: a leading `/` is bundle-root-relative; otherwise file-relative
				// first, then (for a bare path with no `./` or `../` prefix) bundle-root-relative.
				const candidates = stripped.startsWith("/")
					? [path.join(bundle.root, stripped.slice(1))]
					: [
							path.resolve(bundle.root, path.dirname(concept.path), stripped),
							...(stripped.startsWith("./") || stripped.startsWith("../") ? [] : [path.resolve(bundle.root, stripped)]),
						];
				let exists = false;
				for (const candidate of candidates) {
					if (yield* fs.exists(candidate)) {
						exists = true;
						break;
					}
				}
				if (exists) continue;
				const range = DiagnosticRange.forFrontmatterPath(concept.document, fieldPath);
				diagnostics.push(
					Diagnostic.make({
						file: concept.path,
						code: "source-resource-missing",
						severity,
						message: `Resource "${value}" does not exist relative to ${concept.path}`,
						...(range === undefined ? {} : { range }),
					}),
				);
			}
		}
		return diagnostics;
	});
