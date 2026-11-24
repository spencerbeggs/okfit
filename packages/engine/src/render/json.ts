import { ErrorText } from "@effected/kit";
import { DiagnosticRange, DiagnosticSeverity } from "@okfit/core";
import { Runtime, Schema } from "effect";
import type { MigrationCode, MigrationFixKind } from "../migrate/findings.js";
import { ENGINE_VERSION } from "../version.js";
import type { Distribution } from "./distribution.js";
import { DistributionField } from "./distribution.js";
import { tally } from "./exit.js";
import type { RenderedDiagnostic } from "./sort.js";
import { sort } from "./sort.js";

const FixKind = Schema.Literals(["okf-version", "root-relative-path"] satisfies ReadonlyArray<MigrationFixKind>);

/** One entry of the `diagnostics` array (K-21). @public */
export const JsonDiagnostic = Schema.Struct({
	source: Schema.Literals(["core.conformance", "core.lint", "profile", "migrate"]),
	file: Schema.String,
	code: Schema.String,
	severity: DiagnosticSeverity,
	message: Schema.String,
	range: Schema.optionalKey(DiagnosticRange),
	fix: Schema.optionalKey(FixKind),
});
/** @public */
export type JsonDiagnostic = typeof JsonDiagnostic.Type;

/** @public */
export const JsonSummary = Schema.Struct({
	conformance_errors: Schema.Number,
	lint_errors: Schema.Number,
	lint_warnings: Schema.Number,
	lint_info: Schema.Number,
	profile_errors: Schema.Number,
	migration_findings: Schema.Number,
	concepts: Schema.Number,
});
/** @public */
export type JsonSummary = typeof JsonSummary.Type;

/**
 * What `validate --target --fix` did: the files written (`applied`, each with the fix kinds it carried), each fix it
 * refused with its reason, the ids whose integrity drifted, and whether nothing was written (`dry_run`).
 *
 * @public
 */
export const JsonFixes = Schema.Struct({
	applied: Schema.Array(
		Schema.Struct({
			path: Schema.String,
			fixes: Schema.Array(FixKind),
		}),
	),
	refused: Schema.Array(
		Schema.Struct({
			file: Schema.String,
			code: Schema.Literals([
				"okf-version-undeclared",
				"okf-version-older",
				"okf-version-unparsable",
				"root-relative-path",
				"computation-locator",
			] satisfies ReadonlyArray<MigrationCode>),
			reason: Schema.String,
		}),
	),
	drifts: Schema.Array(Schema.String),
	dry_run: Schema.Boolean,
});
/** @public */
export type JsonFixes = typeof JsonFixes.Type;

/**
 * K-21's success envelope, snake_case. `exit_code` is `0 | 1 | 2` only: an
 * infrastructure failure never produces this envelope, it produces the
 * `JsonErrorEnvelope` (K-22). `okfit_version` and `producer` identify the
 * PACKAGE that produced the report (J-2), so the CLI and the MCP server
 * legitimately report different numbers over one bundle without that
 * reading as drift (okfit #75); `engine_version` and `okf_version` are the
 * pair that determines the report's content and the pair a reader should
 * actually compare across two producers. `okf_version` is the version the
 * bundle's root index declares, `null` when it declares none. `distribution` names the
 * meta-package the bins were installed through (`@okfit/plugin`), or `null`
 * for a direct install of `@okfit/cli`/`@okfit/mcp` (okfit #137).
 *
 * @public
 */
export const JsonEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	engine_version: Schema.String,
	producer: Schema.String,
	distribution: DistributionField,
	okf_version: Schema.NullOr(Schema.String),
	root: Schema.String,
	profile: Schema.NullOr(Schema.String),
	exit_code: Schema.Literals([0, 1, 2]),
	target: Schema.optionalKey(Schema.String),
	fixes: Schema.optionalKey(JsonFixes),
	summary: JsonSummary,
	diagnostics: Schema.Array(JsonDiagnostic),
});
/** @public */
export type JsonEnvelope = typeof JsonEnvelope.Type;

/**
 * K-22's envelope: the ONLY thing stdout carries under `--format json` on an
 * infrastructure failure. `exit_code` is `3` for most errors, or `64` for the
 * usage-tier errors (`VerifySelectionError` and the like) that carry
 * their own `[Runtime.errorExitCode]`.
 *
 * @public
 */
export const JsonErrorEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	engine_version: Schema.String,
	distribution: DistributionField,
	exit_code: Schema.Literals([3, 64]),
	error: Schema.Struct({ tag: Schema.String, message: Schema.String }),
});
/** @public */
export type JsonErrorEnvelope = typeof JsonErrorEnvelope.Type;

const toJsonDiagnostic = (d: RenderedDiagnostic): JsonDiagnostic => ({
	source: d.source,
	file: d.file,
	code: d.code,
	severity: d.severity,
	message: d.message,
	// exactOptionalPropertyTypes: omit the key rather than set it to undefined (CORE/internal/lintRules.ts:40).
	...(d.range === undefined ? {} : { range: d.range }),
	...(d.fix === undefined ? {} : { fix: d.fix }),
});

/**
 * Build the success envelope. `diagnostics` is sorted here with the same
 * `sort` the human renderer uses (K-21's "diagnostics are in the K-17
 * order"); `range` passes through as core computed it, zero-based.
 *
 * The value returned is in `Type` form (its `range`s are `DiagnosticRange`
 * instances). What stdout carries is `Schema.encodeSync(JsonEnvelope)` of it,
 * `JSON.stringify`-ed — one document, no trailing text.
 *
 * @public
 */
export const json = (input: {
	readonly okfitVersion: string;
	readonly producer: string;
	readonly okfVersion: string | null;
	readonly root: string;
	readonly profile: string | null;
	readonly exitCode: 0 | 1 | 2;
	readonly concepts: number;
	readonly diagnostics: ReadonlyArray<RenderedDiagnostic>;
	readonly distribution?: Distribution;
	/** The `--target` version the report was read against; omitted from the envelope when absent. */
	readonly target?: string;
	/** What `--fix` did; omitted from the envelope when absent (no `--fix`). */
	readonly fixes?: JsonFixes;
}): JsonEnvelope => {
	const t = tally(input.diagnostics);
	return {
		schema: 1,
		okfit_version: input.okfitVersion,
		engine_version: ENGINE_VERSION,
		producer: input.producer,
		distribution: input.distribution ?? null,
		okf_version: input.okfVersion,
		root: input.root,
		profile: input.profile,
		exit_code: input.exitCode,
		...(input.target === undefined ? {} : { target: input.target }),
		...(input.fixes === undefined ? {} : { fixes: input.fixes }),
		summary: {
			conformance_errors: t.conformanceErrors,
			lint_errors: t.lintErrors,
			lint_warnings: t.lintWarnings,
			lint_info: t.lintInfo,
			profile_errors: t.profileErrors,
			migration_findings: input.diagnostics.filter((d) => d.source === "migrate").length,
			concepts: input.concepts,
		},
		diagnostics: sort(input.diagnostics).map(toJsonDiagnostic),
	};
};

/** The error's `_tag` when it has one, else its constructor name; `"UnknownError"` for a non-object value. */
const tagOf = (error: unknown): string => {
	if (typeof error !== "object" || error === null) return "UnknownError";
	const tag = (error as { readonly _tag?: unknown })._tag;
	if (typeof tag === "string") return tag;
	return error.constructor?.name ?? "UnknownError";
};

/**
 * The `[Runtime.errorExitCode]` marker's value when it is present and is one
 * of the two exit codes the JSON error envelope can carry; `3` otherwise
 * (the envelope's own default, distinct from `Runtime.getErrorExitCode`'s
 * process-level default of `1`).
 */
const exitCodeOf = (error: unknown): 3 | 64 => {
	if (typeof error === "object" && error !== null && Runtime.errorExitCode in error) {
		const code = (error as Record<PropertyKey, unknown>)[Runtime.errorExitCode];
		if (code === 64) return 64;
	}
	return 3;
};

/** K-22. `tag` is the error's `_tag` when it has one, else its constructor name. @public */
export const jsonError = (error: unknown, okfitVersion: string, distribution?: Distribution): JsonErrorEnvelope => ({
	schema: 1,
	okfit_version: okfitVersion,
	engine_version: ENGINE_VERSION,
	distribution: distribution ?? null,
	exit_code: exitCodeOf(error),
	error: { tag: tagOf(error), message: ErrorText.describe(error) },
});
