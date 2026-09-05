import { Schema } from "effect";
import { DiagnosticRange } from "./Diagnostic.js";

/** One `index.md` list item. @public */
export class IndexEntry extends Schema.Class<IndexEntry>("IndexEntry")({
	title: Schema.String,
	target: Schema.String,
	description: Schema.optionalKey(Schema.String),
	range: DiagnosticRange,
}) {}

/** One `index.md` H1 section. @public */
export class IndexSection extends Schema.Class<IndexSection>("IndexSection")({
	heading: Schema.String,
	entries: Schema.Array(IndexEntry),
	range: DiagnosticRange,
}) {}

/**
 * A parsed `index.md` (D-21). `okfVersion` is present only on the bundle root.
 * @public
 */
export class IndexDocument extends Schema.Class<IndexDocument>("IndexDocument")({
	path: Schema.String,
	dir: Schema.String,
	okfVersion: Schema.optionalKey(Schema.String),
	sections: Schema.Array(IndexSection),
}) {}
