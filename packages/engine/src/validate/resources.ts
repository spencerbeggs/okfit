import type { LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Concept, Diagnostic, DiagnosticRange, OkfitConfig as OkfitConfigNS } from "@okfit/core";
import type { FileSystem, Path, PlatformError } from "effect";
import { Effect } from "effect";
import { locateResource, outsideProjectDiagnostic } from "./repository.js";

/** A `resource`/`sources[].resource` value that names a URL, not a bundle-relative path (D-24). */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Glob metacharacters, extglob openers included, that mark a value as a pattern rather than a literal path. */
export const GLOB_RE = /[*?[{]|[@+!]\(/;

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
export const isDescriptor = (value: string): boolean =>
	SCHEME_RE.test(value) || value.includes("://") || /\s/.test(value) || GLOB_RE.test(value);

/** One `resource`/`sources[i].resource` value, paired with the frontmatter path that names it. */
export interface ResourceValue {
	readonly value: string;
	readonly path: ReadonlyArray<string | number>;
}

/** Every `resource` value on a concept, each with its own frontmatter path: the top-level field, then each source's. */
export const resourceValuesOf = (concept: LoadedConcept): Array<ResourceValue> => {
	const values: Array<ResourceValue> = [];
	if (concept.frontmatter.resource !== undefined)
		values.push({ value: concept.frontmatter.resource, path: ["resource"] });
	concept.frontmatter.sources?.forEach((source, index) => {
		values.push({
			value: source.resource,
			path: [...Concept.entryPath(concept.frontmatter, "sources", index), "resource"],
		});
	});
	return values;
};

/**
 * D-24's `resource`/`sources[].resource` value resolves to nothing for every
 * non-descriptor value on every concept (issue #106). A `resource` is a
 * descriptor (a URL, a scope description, or a glob pattern) or a literal path
 * resolved in OKF 0.3 §6 order (see `resourceCandidates`). okfit checks a path
 * only inside `projectRoot`: a value that resolves outside it, lexically or
 * through a symlink, is never read, stat'ed or asked about, and is reported
 * from its text alone as `resource-outside-project` (okfit's repository check,
 * not OKF); a value inside it that exists nowhere stays `source-resource-missing`.
 * Ranges at the offending value via `DiagnosticRange.forFrontmatterPath`, using
 * the `["resource"]` or `["sources", index, "resource"]` path the value came
 * from. Total over severity: returns `[]`, touching neither `FileSystem` nor
 * `Path`, only when both codes are `off`.
 *
 * @public
 */
export const lintResources = (
	bundle: LoadedBundle,
	config: OkfitConfig,
	projectRoot: string,
): Effect.Effect<ReadonlyArray<Diagnostic>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const missingSeverity = OkfitConfigNS.severityFor(config, "source-resource-missing");
		const outsideSeverity = OkfitConfigNS.severityFor(config, "resource-outside-project");
		if (missingSeverity === "off" && outsideSeverity === "off") return [];
		const diagnostics: Array<Diagnostic> = [];
		for (const [, concept] of bundle.concepts) {
			for (const { value, path: fieldPath } of resourceValuesOf(concept)) {
				if (isDescriptor(value)) continue;
				const location = yield* locateResource({ bundle, concept, value, projectRoot });
				if (location._tag === "found") continue;
				if (location._tag === "outside") {
					if (outsideSeverity !== "off")
						diagnostics.push(outsideProjectDiagnostic(concept, value, fieldPath, outsideSeverity));
					continue;
				}
				if (missingSeverity === "off") continue;
				const range = DiagnosticRange.forFrontmatterPath(concept.document, fieldPath);
				diagnostics.push(
					Diagnostic.make({
						file: concept.path,
						code: "source-resource-missing",
						severity: missingSeverity,
						message: `Resource "${value}" does not exist relative to ${concept.path}`,
						...(range === undefined ? {} : { range }),
					}),
				);
			}
		}
		return diagnostics;
	});
