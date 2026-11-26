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
 * A parsed `index.md` (D-21). The metadata fields are present only on the bundle root (OKF 0.3 section 8.1):
 * `okfVersion`, `title`, `description` and `license` are the typed reads, `metadata` is the whole decoded
 * mapping (extension keys included) and `frontmatter` is the raw YAML text between the fences.
 * @public
 */
export class IndexDocument extends Schema.Class<IndexDocument>("IndexDocument")({
	path: Schema.String,
	dir: Schema.String,
	okfVersion: Schema.optionalKey(Schema.String),
	title: Schema.optionalKey(Schema.String),
	description: Schema.optionalKey(Schema.String),
	license: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
	frontmatter: Schema.optionalKey(Schema.String),
	sections: Schema.Array(IndexSection),
	/** The file's text as the load read it (a leading byte-order mark dropped); absent on a hand-built document. */
	source: Schema.optionalKey(Schema.String),
}) {}
