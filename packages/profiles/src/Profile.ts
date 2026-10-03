import type { LoadedBundle, OkfitConfig } from "@okfit/core";
import { DiagnosticRange, DiagnosticSeverity } from "@okfit/core";
import { Schema } from "effect";

/**
 * Names of the profiles this package ships (P-38).
 *
 * @public
 */
export const PROFILE_NAMES = ["software-project"] as const;

/**
 * A profile name shipped by this package.
 *
 * @public
 */
export type ProfileName = (typeof PROFILE_NAMES)[number];

/**
 * One concept directory of a profile's bundle layout (P-26). Each directory
 * carries its own `index.md`; `type` is the `types.<Name>` key held there.
 *
 * @public
 */
export interface LayoutDirectory {
	readonly directory: string;
	readonly type: string;
}

/**
 * Scaffolding data for `okfit init` (spec 5.2); never part of `OkfitConfig`
 * (P-26). What the CLI writes into these files is the CLI plan's concern.
 *
 * @public
 */
export interface Layout {
	readonly root: { readonly index: "index.md"; readonly log: "log.md"; readonly project: "project.md" };
	readonly directories: ReadonlyArray<LayoutDirectory>;
}

/**
 * Profile-owned diagnostic codes (P-21). Core's `LintCode` is untouched; all
 * three are severity `error` and are not configurable.
 *
 * @public
 */
export const ProfileDiagnosticCode = Schema.Literals(["project-missing", "project-multiple", "project-not-at-root"]);

/**
 * The type of `ProfileDiagnosticCode`.
 *
 * @public
 */
export type ProfileDiagnosticCode = typeof ProfileDiagnosticCode.Type;

/**
 * Same fields as core's `Diagnostic` with a profile code; a `Schema.Struct`
 * per P-21/P-51. `file` is the bundle-relative posix path, `""` for the
 * bundle-level `project-missing`. `range` is never set in phase 1.
 *
 * @public
 */
export const ProfileDiagnostic = Schema.Struct({
	file: Schema.String,
	range: Schema.optionalKey(DiagnosticRange),
	code: ProfileDiagnosticCode,
	severity: DiagnosticSeverity,
	message: Schema.String,
});

/**
 * The type of `ProfileDiagnostic`.
 *
 * @public
 */
export type ProfileDiagnostic = typeof ProfileDiagnostic.Type;

/**
 * One Surface concept a docs preset writes: a bundle-relative `file` and the
 * frontmatter and body to write there. `resource` is relative to the file.
 * The `site` preset's `url` is an `https://example.invalid` placeholder the
 * docs skill replaces.
 *
 * @public
 */
export interface SurfaceTemplate {
	readonly file: string;
	readonly frontmatter: {
		readonly type: "Surface";
		readonly status: "draft";
		readonly title: string;
		readonly description: string;
		readonly kind: "site" | "repo" | "readme";
		readonly audience: "users" | "contributors" | "agents";
		readonly resource: string;
		readonly links_to?: string;
		readonly url?: string;
	};
	readonly body: string;
}

/**
 * A named set of Surface templates for one repository shape. `additive` is
 * true only for `site`, which layers on another preset instead of replacing it.
 *
 * @public
 */
export interface DocsPreset {
	readonly name: "npm-package" | "monorepo-router" | "monorepo-shared-docs" | "site";
	readonly description: string;
	readonly additive: boolean;
	readonly surfaces: ReadonlyArray<SurfaceTemplate>;
}

/**
 * A named profile (P-38): a partial `OkfitConfig` the CLI merges as
 * `DEFAULTS < profile < file`, a scaffolding `Layout`, and a pure `check`
 * over a loaded bundle run after `Validate.all`.
 *
 * @public
 */
export interface Profile {
	readonly name: ProfileName;
	readonly config: OkfitConfig;
	readonly layout: Layout;
	readonly docsPresets: ReadonlyArray<DocsPreset>;
	readonly check: (bundle: LoadedBundle) => ReadonlyArray<ProfileDiagnostic>;
}
