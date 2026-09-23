/**
 * `DiagnosticRange` (core) to LSP `Range`/`Location` conversion: zero-based
 * line and UTF-16 character on both sides, so no unit conversion happens at
 * the boundary -- only the end position needs computing from the range's
 * `offset + length`, the same technique `convert/diagnostic.ts`'s
 * `toLspDiagnostic` uses for a diagnostic's end position.
 *
 * @packageDocumentation
 */
import { DiagnosticRange } from "@okfit/core";
import type { Location, Range } from "../protocol/types.js";

/**
 * `range` as an LSP `Range` over `text`, the source of the file `range`
 * points into. The start comes straight from `range.line`/`range.character`;
 * the end is computed by re-mapping `range.offset + range.length` through
 * `text` so a multi-line span ends on the correct later line.
 *
 * @public
 */
export const toLspRange = (text: string, range: DiagnosticRange): Range => {
	const start = { line: range.line, character: range.character };
	const end = DiagnosticRange.fromOffset(text, range.offset + range.length, 0);
	return { start, end: { line: end.line, character: end.character } };
};

/**
 * `range` as an LSP `Location` at `uri`, over `text`, the source of the file
 * `range` points into.
 *
 * @public
 */
export const toLspLocation = (uri: string, text: string, range: DiagnosticRange): Location => ({
	uri,
	range: toLspRange(text, range),
});
