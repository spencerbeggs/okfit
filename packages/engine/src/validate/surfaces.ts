import { GlobPattern } from "@effected/glob";
import type { LoadedBundle, OkfitConfig } from "@okfit/core";
import { Diagnostic, DiagnosticRange, OkfitConfig as OkfitConfigNS } from "@okfit/core";
import { SURFACE_TYPE } from "@okfit/profiles";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result } from "effect";

/** Glob metacharacters that mark a Surface `resource` as a pattern rather than a literal path. */
const GLOB_RE = /[*?[{]/;

/**
 * A Surface's `resource` glob matches nothing on disk. Only concepts of type
 * `Surface` whose `resource` contains a glob metacharacter are checked; a
 * literal `resource` is `lintResources`'s concern (`source-resource-missing`).
 * The pattern is resolved against the concept's directory into a repo-absolute
 * pattern, split at its first metacharacter segment into a static `prefix` and
 * a `rest`; the `prefix` directory is listed (recursively when `rest` spans
 * segments) and `rest` is matched against the entries. A missing or unreadable
 * `prefix` (for example a file), an empty match, or a `rest` that fails to compile all count as unmatched, and
 * report a warning (a brand-new monorepo legitimately has no packages yet),
 * ranged at the `["resource"]` frontmatter value. Total over severity (mirrors
 * `lintResources`): returns `[]`, touching neither `FileSystem` nor `Path`,
 * the moment `OkfitConfig.severityFor(config, "surface-unmatched")` is `"off"`.
 *
 * @public
 */
export const lintSurfaces = (
	bundle: LoadedBundle,
	config: OkfitConfig,
): Effect.Effect<ReadonlyArray<Diagnostic>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const severity = OkfitConfigNS.severityFor(config, "surface-unmatched");
		if (severity === "off") return [];
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const diagnostics: Array<Diagnostic> = [];
		for (const [, concept] of bundle.concepts) {
			if (concept.frontmatter.type !== SURFACE_TYPE) continue;
			const resource = concept.frontmatter.resource;
			if (resource === undefined || !GLOB_RE.test(resource)) continue;
			const absolute = path.resolve(bundle.root, path.dirname(concept.path), resource);
			const segments = absolute.split(path.sep);
			const firstGlob = segments.findIndex((segment) => GLOB_RE.test(segment));
			const prefix = segments.slice(0, firstGlob).join(path.sep) || path.sep;
			const rest = segments.slice(firstGlob).join("/");
			let problem: string | undefined;
			if (!(yield* fs.exists(prefix).pipe(Effect.orElseSucceed(() => false)))) {
				problem = "";
			} else {
				const compiled = GlobPattern.compileResult(rest);
				if (Result.isFailure(compiled)) {
					problem = `: ${compiled.failure.message}`;
				} else {
					const entries = yield* fs
						.readDirectory(prefix, { recursive: rest.includes("**") || rest.includes("/") })
						.pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
					if (!entries.some((entry) => compiled.success.matches(entry.split(path.sep).join("/")))) problem = "";
				}
			}
			if (problem === undefined) continue;
			const range = DiagnosticRange.forFrontmatterPath(concept.document, ["resource"]);
			diagnostics.push(
				Diagnostic.make({
					file: concept.path,
					code: "surface-unmatched",
					severity,
					message: `Surface resource "${resource}" matches nothing under ${path.relative(bundle.root, prefix) || "."}${problem}`,
					...(range === undefined ? {} : { range }),
				}),
			);
		}
		return diagnostics;
	});
