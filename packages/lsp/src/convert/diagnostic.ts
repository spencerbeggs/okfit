/**
 * `RenderedDiagnostic` (from `@okfit/engine`) to LSP `Diagnostic` conversion,
 * plus the concept-text lookup a caller needs to compute end positions.
 *
 * @packageDocumentation
 */
import type { LoadedBundle } from "@okfit/core";
import { ConceptId, DiagnosticRange } from "@okfit/core";
import type { RenderedDiagnostic } from "@okfit/engine";
import { Option } from "effect";
import type { LspDiagnostic } from "../protocol/types.js";

/**
 * LSP `DiagnosticSeverity` values for `RenderedDiagnostic["severity"]`,
 * spelled out rather than imported from the library (the library entry is
 * off-limits outside the allowlisted seam files).
 *
 * @public
 */
export const SEVERITY = { error: 1, warning: 2, info: 3 } as const;

const ZERO_RANGE: LspDiagnostic["range"] = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

/**
 * `diagnostic` as an LSP `Diagnostic`. `text` is the source of the file the
 * diagnostic points at; when given and `diagnostic.range` is set, the end
 * position is computed from the text so it lands correctly across a
 * multi-line span. Without `text`, the end is the start plus the range's
 * length on the same line. A range-less diagnostic gets the zero range.
 *
 * @public
 */
export const toLspDiagnostic = (diagnostic: RenderedDiagnostic, text: string | undefined): LspDiagnostic => {
	const { range } = diagnostic;
	const lspRange =
		range === undefined
			? ZERO_RANGE
			: {
					start: { line: range.line, character: range.character },
					end:
						text === undefined
							? { line: range.line, character: range.character + range.length }
							: (({ line, character }) => ({ line, character }))(
									DiagnosticRange.fromOffset(text, range.offset + range.length, 0),
								),
				};
	return {
		range: lspRange,
		severity: SEVERITY[diagnostic.severity],
		code: diagnostic.code,
		source: "okfit",
		message: diagnostic.message,
		data: { source: diagnostic.source },
	};
};

/**
 * The loaded source text of the concept at bundle-relative `file`, or
 * `undefined` when `file` is not a concept id or is not in `bundle`.
 *
 * @public
 */
export const sourceTextOf = (bundle: LoadedBundle, file: string): string | undefined =>
	Option.match(ConceptId.fromPath(file), {
		onNone: () => undefined,
		onSome: (id) => bundle.concepts.get(id)?.document.source,
	});
