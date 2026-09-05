import { Schema } from "effect";
import { AttestedComputation } from "./AttestedComputation.js";
import { Generated } from "./Generated.js";
import { Source, UsageWindow } from "./Source.js";
import { Status } from "./Status.js";
import { Timestamp } from "./Timestamp.js";
import { Verification } from "./Verification.js";

/**
 * The exact `type` value that enables the computation family (D-20).
 * @public
 */
export const ATTESTED_COMPUTATION_TYPE = "Attested Computation" as const;

/**
 * A typed OKF concept: the stage-1 envelope (`type`), every optional family,
 * unknown keys in `extensions`, and the whole decoded mapping in `raw`.
 *
 * @remarks
 * The strict codec for tooling that builds values. `Bundle.load` never decodes
 * through it whole: `internal/conceptDecode.ts` decodes the envelope, then each
 * family independently, then calls `Concept.make` (D-15). `attested` is a field,
 * not a subclass, so a bad `executor` cannot reject the concept.
 * @public
 */
export class Concept extends Schema.Class<Concept>("Concept")({
	type: Schema.String.check(Schema.isNonEmpty()),
	title: Schema.optionalKey(Schema.String),
	description: Schema.optionalKey(Schema.String),
	resource: Schema.optionalKey(Schema.String),
	tags: Schema.optionalKey(Schema.Array(Schema.String)),
	sources: Schema.optionalKey(Schema.Array(Source)),
	usage_window: Schema.optionalKey(UsageWindow),
	generated: Schema.optionalKey(Generated),
	verified: Schema.optionalKey(Verification.List),
	status: Schema.optionalKey(Status),
	stale_after: Schema.optionalKey(Timestamp),
	attested: Schema.optionalKey(AttestedComputation),
	extensions: Schema.Record(Schema.String, Schema.Unknown),
	raw: Schema.Record(Schema.String, Schema.Unknown),
}) {}
