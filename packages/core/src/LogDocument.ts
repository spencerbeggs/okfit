import { Schema } from "effect";
import { DiagnosticRange } from "./Diagnostic.js";

/** One `log.md` list item. @public */
export class LogItem extends Schema.Class<LogItem>("LogItem")({
	text: Schema.String,
	range: DiagnosticRange,
}) {}

/** One `log.md` `## YYYY-MM-DD` group. @public */
export class LogGroup extends Schema.Class<LogGroup>("LogGroup")({
	date: Schema.String,
	items: Schema.Array(LogItem),
	range: DiagnosticRange,
}) {}

/**
 * A parsed `log.md` (D-21).
 * @public
 */
export class LogDocument extends Schema.Class<LogDocument>("LogDocument")({
	path: Schema.String,
	dir: Schema.String,
	title: Schema.optionalKey(Schema.String),
	groups: Schema.Array(LogGroup),
}) {}
