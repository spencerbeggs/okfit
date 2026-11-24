import { GlobPattern } from "@effected/glob";
import { descend } from "@effected/walker";
import type { LoadedBundle, OkfitConfig } from "@okfit/core";
import { Diagnostic, DiagnosticRange, OkfitConfig as OkfitConfigNS } from "@okfit/core";
import { SURFACE_TYPE } from "@okfit/profiles";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result } from "effect";
import { outsideProjectDiagnostic, withinRoot } from "./repository.js";
import { GLOB_RE } from "./resources.js";

/**
 * A Surface's `resource` glob matches nothing on disk. Only concepts of type
 * `Surface` whose `resource` contains a glob metacharacter are checked; a
 * literal `resource` is `lintResources`'s concern (`source-resource-missing`).
 * The pattern is split, as written, at its first metacharacter segment into a
 * static `prefix` (resolved against the concept's directory) and a `rest`; the
 * `prefix` directory is walked only as deep as `rest` can match (unbounded with
 * `**`, skipping `node_modules` and dot-directories `rest` does not name) and
 * `rest` is matched against the entries. A missing or unreadable `prefix` (for
 * example a file), an empty match, or a `rest` that fails to compile all count
 * as unmatched, and report a warning (a brand-new monorepo legitimately has no
 * packages yet), ranged at the `["resource"]` frontmatter value. Total over
 * severity (mirrors `lintResources`): returns `[]`, touching neither
 * `FileSystem` nor `Path`, the moment
 * `OkfitConfig.severityFor(config, "surface-unmatched")` is `"off"`.
 *
 * @public
 */
export const lintSurfaces = (
	bundle: LoadedBundle,
	config: OkfitConfig,
	projectRoot: string,
): Effect.Effect<ReadonlyArray<Diagnostic>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const severity = OkfitConfigNS.severityFor(config, "surface-unmatched");
		const outsideSeverity = OkfitConfigNS.severityFor(config, "resource-outside-project");
		if (severity === "off" && outsideSeverity === "off") return [];
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const diagnostics: Array<Diagnostic> = [];
		for (const [, concept] of bundle.concepts) {
			if (concept.frontmatter.type !== SURFACE_TYPE) continue;
			const resource = concept.frontmatter.resource;
			if (resource === undefined || !GLOB_RE.test(resource)) continue;
			// Split on the resource as written, not on the resolved absolute path:
			// a metacharacter in the bundle root's own path must not move the split.
			// A leading `/` anchors at the bundle root (OKF 0.3 section 3.2), as a literal repository resource does.
			const rooted = resource.startsWith("/");
			const written = (rooted ? resource.slice(1) : resource).split("/");
			const firstGlob = written.findIndex((segment) => GLOB_RE.test(segment));
			if (firstGlob < 0) continue;
			const prefix = path.resolve(
				bundle.root,
				rooted ? "" : path.dirname(concept.path),
				...written.slice(0, firstGlob),
			);
			// A prefix outside the project root is reported as `resource-outside-project` and never reaches the disk.
			if (!withinRoot(projectRoot, prefix, path)) {
				if (outsideSeverity !== "off")
					diagnostics.push(outsideProjectDiagnostic(concept, resource, ["resource"], outsideSeverity));
				continue;
			}
			const restSegments = written.slice(firstGlob);
			const rest = restSegments.join("/");
			let problem: string | undefined;
			// `descend` reads only directories a match can lie in, never enters a symlinked directory, and treats
			// a symlinked base as empty, so the prefix is resolved first; that real path must stay inside the
			// project, or a link under it that points out would be walked.
			const real = yield* fs.realPath(prefix).pipe(Effect.orElseSucceed(() => undefined));
			if (real === undefined) {
				problem = "";
			} else {
				const realProject = yield* fs.realPath(projectRoot).pipe(Effect.orElseSucceed(() => projectRoot));
				if (!withinRoot(realProject, real, path)) {
					if (outsideSeverity !== "off")
						diagnostics.push(outsideProjectDiagnostic(concept, resource, ["resource"], outsideSeverity));
					continue;
				}
				const compiled = GlobPattern.compileResult(rest);
				if (Result.isFailure(compiled)) {
					problem = `: ${compiled.failure.message}`;
				} else {
					// `node_modules` stays pruned unless the pattern names it.
					const matches = yield* descend(compiled.success, {
						cwd: real,
						match: "any",
						prune: restSegments.some((segment) => segment.includes("node_modules")) ? [] : ["node_modules"],
						onUnreadable: "skip",
					}).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
					if (matches.length === 0) problem = "";
				}
			}
			if (problem === undefined || severity === "off") continue;
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
