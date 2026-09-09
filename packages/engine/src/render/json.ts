import { DiagnosticRange, DiagnosticSeverity } from "@okfit/core";
import { Schema } from "effect";
import { tally } from "./exit.js";
import type { RenderedDiagnostic } from "./sort.js";
import { sort } from "./sort.js";

/** One entry of the `diagnostics` array (K-21). @public */
export const JsonDiagnostic = Schema.Struct({
	source: Schema.Literals(["core.conformance", "core.lint", "profile"]),
	file: Schema.String,
	code: Schema.String,
	severity: DiagnosticSeverity,
	message: Schema.String,
	range: Schema.optionalKey(DiagnosticRange),
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
	concepts: Schema.Number,
});
/** @public */
export type JsonSummary = typeof JsonSummary.Type;

/**
 * K-21's success envelope, snake_case. `exit_code` is `0 | 1 | 2` only: an
 * infrastructure failure never produces this envelope, it produces the
 * `JsonErrorEnvelope` (K-22).
 *
 * @public
 */
export const JsonEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	okf_version: Schema.String,
	root: Schema.String,
	profile: Schema.NullOr(Schema.String),
	exit_code: Schema.Literals([0, 1, 2]),
	summary: JsonSummary,
	diagnostics: Schema.Array(JsonDiagnostic),
});
/** @public */
export type JsonEnvelope = typeof JsonEnvelope.Type;

/** K-22's envelope: the ONLY thing stdout carries under `--format json` on an exit-3 failure. @public */
export const JsonErrorEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	exit_code: Schema.Literal(3),
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
	readonly okfVersion: string;
	readonly root: string;
	readonly profile: string | null;
	readonly exitCode: 0 | 1 | 2;
	readonly concepts: number;
	readonly diagnostics: ReadonlyArray<RenderedDiagnostic>;
}): JsonEnvelope => {
	const t = tally(input.diagnostics);
	return {
		schema: 1,
		okfit_version: input.okfitVersion,
		okf_version: input.okfVersion,
		root: input.root,
		profile: input.profile,
		exit_code: input.exitCode,
		summary: {
			conformance_errors: t.conformanceErrors,
			lint_errors: t.lintErrors,
			lint_warnings: t.lintWarnings,
			lint_info: t.lintInfo,
			profile_errors: t.profileErrors,
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

/** The error's `message` when it has one as a string, else `String(error)`. */
const messageOf = (error: unknown): string => {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { readonly message: unknown }).message;
		if (typeof message === "string") return message;
	}
	return String(error);
};

/** K-22. `tag` is the error's `_tag` when it has one, else its constructor name. @public */
export const jsonError = (error: unknown, okfitVersion: string): JsonErrorEnvelope => ({
	schema: 1,
	okfit_version: okfitVersion,
	exit_code: 3,
	error: { tag: tagOf(error), message: messageOf(error) },
});
