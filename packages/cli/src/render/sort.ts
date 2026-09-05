import type { Diagnostic, DiagnosticRange, DiagnosticSeverity } from "@okfit/core";
import type { ProfileDiagnostic } from "@okfit/profiles";

/** Which producer a diagnostic came from; the JSON envelope's `source` (K-21). @public */
export type DiagnosticSource = "core.conformance" | "core.lint" | "profile";

/**
 * The one shape both renderers consume. `file` is the bundle-relative posix
 * path core produced, `""` for a bundle-level finding. `range` is core's own
 * zero-based `DiagnosticRange` instance, passed through untouched (K-21).
 * `code` is widened to `string`: core's `DiagnosticCode`
 * (`CORE/Diagnostic.ts:45-46`) and profiles' `ProfileDiagnosticCode`
 * (`PROFILES/Profile.ts:47`) are disjoint closed unions and this carries
 * either.
 *
 * @public
 */
export interface RenderedDiagnostic {
	readonly source: DiagnosticSource;
	readonly file: string;
	readonly range?: DiagnosticRange;
	readonly code: string;
	readonly severity: DiagnosticSeverity;
	readonly message: string;
}

const toRendered =
	(source: DiagnosticSource) =>
	(entry: {
		readonly file: string;
		readonly range?: DiagnosticRange;
		readonly code: string;
		readonly severity: DiagnosticSeverity;
		readonly message: string;
	}): RenderedDiagnostic => ({
		source,
		file: entry.file,
		code: entry.code,
		severity: entry.severity,
		message: entry.message,
		// exactOptionalPropertyTypes: omit the key rather than set it to undefined (CORE/internal/lintRules.ts:40).
		...(entry.range === undefined ? {} : { range: entry.range }),
	});

/**
 * Tag core's two arrays and profiles' one, in producer order. Not named
 * `merge`: `OkfitConfig.merge` already owns that word in this codebase.
 *
 * @public
 */
export const collect = (
	conformance: ReadonlyArray<Diagnostic>,
	lint: ReadonlyArray<Diagnostic>,
	profile: ReadonlyArray<ProfileDiagnostic>,
): ReadonlyArray<RenderedDiagnostic> => [
	...conformance.map(toRendered("core.conformance")),
	...lint.map(toRendered("core.lint")),
	...profile.map(toRendered("profile")),
];

/** Range-less entries sort before ranged ones within the same file; ranged entries by `offset`. */
const compareRange = (a: RenderedDiagnostic, b: RenderedDiagnostic): number => {
	if (a.range === undefined && b.range === undefined) return 0;
	if (a.range === undefined) return -1;
	if (b.range === undefined) return 1;
	return a.range.offset - b.range.offset;
};

/**
 * K-17: `file` ascending (so `""` — the bundle-level finding — leads), then
 * range-less before ranged within a file, then `range.offset` ascending, then
 * `code`. Plain code-unit comparison, never locale-dependent (the same rule
 * profiles' own `check` sorts by, `PROFILES/SoftwareProject.ts:119`). Stable:
 * implemented with `toSorted`, which is specified as stable.
 *
 * @public
 */
export const sort = (diagnostics: ReadonlyArray<RenderedDiagnostic>): ReadonlyArray<RenderedDiagnostic> =>
	diagnostics.toSorted((a, b) => {
		if (a.file !== b.file) return a.file < b.file ? -1 : 1;
		const byRange = compareRange(a, b);
		if (byRange !== 0) return byRange;
		if (a.code !== b.code) return a.code < b.code ? -1 : 1;
		return 0;
	});
