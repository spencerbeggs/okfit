import { Schema } from "effect";
import { Actor } from "./Actor.js";
import { Timestamp } from "./Timestamp.js";

/**
 * A closed interval of use, on a concept or on one of its sources.
 * @public
 */
export class UsageWindow extends Schema.Class<UsageWindow>("UsageWindow")({
	from: Timestamp,
	to: Timestamp,
}) {}

/**
 * One provenance entry. `resource` is a URL, a bundle path or a scope descriptor (D-24); never resolved here.
 * @public
 */
export class Source extends Schema.Class<Source>("Source")({
	resource: Schema.String,
	id: Schema.optionalKey(Schema.String),
	title: Schema.optionalKey(Schema.String),
	author: Schema.optionalKey(Actor),
	usage_count: Schema.optionalKey(Schema.Union([Schema.Number, Schema.FiniteFromString])),
	last_modified: Schema.optionalKey(Timestamp),
	usage_window: Schema.optionalKey(UsageWindow),
}) {}
