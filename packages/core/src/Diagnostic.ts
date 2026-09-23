import type { MarkdownDocument } from "@effected/markdown";
import { Schema } from "effect";
import { lineCharacter } from "./internal/position.js";
import { frontmatterPathSpan } from "./internal/yamlPathSpan.js";

/** @public */
export const DiagnosticSeverity = Schema.Literals(["error", "warning", "info"]);
/** @public */
export type DiagnosticSeverity = typeof DiagnosticSeverity.Type;

/** Always `"error"`, never configurable (D-33). @public */
export const ConformanceCode = Schema.Literals([
	"frontmatter-missing",
	"frontmatter-unclosed",
	"frontmatter-unparseable",
	"type-missing",
	"index-frontmatter",
	"index-malformed",
	"log-heading-invalid",
	"log-malformed",
]);
/** @public */
export type ConformanceCode = typeof ConformanceCode.Type;

/** Severity from `OkfitConfig` (D-34). @public */
export const LintCode = Schema.Literals([
	"broken-links",
	"missing-index",
	"unknown-type",
	"required-key-missing",
	"field-value-unknown",
	"require-verified-unmet",
	"family-invalid",
	"computation-runtime-missing",
	"footnote-source-unknown",
	"footnote-undefined",
	"log-frontmatter",
	"actor-prefix-unknown",
	"legacy-timestamp",
	"config-unknown-key",
	"stale",
	"walk-unreadable",
	"generated-at-drift",
	"status-missing",
	"source-resource-missing",
	"generated-missing",
]);
/** @public */
export type LintCode = typeof LintCode.Type;

/** @public */
export const DiagnosticCode = Schema.Union([ConformanceCode, LintCode]);
/** @public */
export type DiagnosticCode = typeof DiagnosticCode.Type;

/**
 * A range inside a file's text, zero-based (D-32); the CLI renders one-based.
 * @public
 */
export class DiagnosticRange extends Schema.Class<DiagnosticRange>("DiagnosticRange")({
	offset: Schema.Number,
	length: Schema.Number,
	line: Schema.Number,
	character: Schema.Number,
}) {
	/** Core's own offset-to-line/character helper over the file text (D-14, `internal/position.ts`). */
	static readonly fromOffset = (text: string, offset: number, length: number): DiagnosticRange => {
		const { line, character } = lineCharacter(text, offset);
		return DiagnosticRange.make({ offset, length, line, character });
	};

	/**
	 * Maps a frontmatter YAML path to the range of its own value inside `document.source`
	 * (decision 2 of the phase 4 plan): the whole frontmatter block for `path: []`, `undefined`
	 * only when the document has no frontmatter block at all, and the block again as a fallback
	 * when the leaf named by `path` cannot be found (an absent key). For a double-quoted scalar
	 * value, the returned range includes the delimiting quote characters, since the yaml kit
	 * reports a quoted scalar's offset and length inclusive of them.
	 *
	 * The public entry point for `@okfit/profiles` and `@okfit/engine`; `@okfit/core`'s own lint
	 * rules call the internal `frontmatterPathRange` (`internal/frontmatter.ts`) directly.
	 *
	 * @public
	 */
	static readonly forFrontmatterPath = (
		document: MarkdownDocument,
		path: ReadonlyArray<string | number>,
	): DiagnosticRange | undefined => {
		if (document.frontmatter === undefined) return undefined;
		const span = frontmatterPathSpan(document.source, document.frontmatter, path);
		return DiagnosticRange.fromOffset(document.source, span.offset, span.length);
	};
}

const CONFORMANCE_CODES = new Set<string>(ConformanceCode.literals);

/**
 * One conformance or lint finding (D-32).
 * @public
 */
export class Diagnostic extends Schema.Class<Diagnostic>("Diagnostic")({
	file: Schema.String,
	range: Schema.optionalKey(DiagnosticRange),
	code: DiagnosticCode,
	severity: DiagnosticSeverity,
	message: Schema.String,
}) {
	/** True when `code` is one of `ConformanceCode`'s always-error members. */
	static readonly isConformance = (diagnostic: Diagnostic): boolean => CONFORMANCE_CODES.has(diagnostic.code);
}
