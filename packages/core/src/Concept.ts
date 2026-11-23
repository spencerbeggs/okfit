import { Schema } from "effect";
import { AttestedComputation } from "./AttestedComputation.js";
import { Generated } from "./Generated.js";
import { Integrity } from "./Integrity.js";
import { Source, UsageWindow } from "./Source.js";
import { Status } from "./Status.js";
import { Timestamp } from "./Timestamp.js";
import { Verification } from "./Verification.js";

/**
 * The exact `type` value that enables the computation family (D-20).
 * @public
 */
export const ATTESTED_COMPUTATION_TYPE = "Attested Computation" as const;

const YamlPath = Schema.Array(Schema.Union([Schema.String, Schema.Number]));

/**
 * The YAML path of each kept entry of the four list families, in kept order. Tolerant
 * reading drops an unreadable entry, so a kept entry's decoded index is not its YAML
 * index; every range or edit path computed from a list family comes from here, through
 * `Concept.entryPath`. A single item (a bare mapping) records `["sources"]`.
 *
 * @public
 */
export class EntryPaths extends Schema.Class<EntryPaths>("EntryPaths")({
	tags: Schema.optionalKey(Schema.Array(YamlPath)),
	sources: Schema.optionalKey(Schema.Array(YamlPath)),
	verified: Schema.optionalKey(Schema.Array(YamlPath)),
	parameters: Schema.optionalKey(Schema.Array(YamlPath)),
}) {}

/**
 * A list family whose kept entries carry a recorded YAML path.
 * @public
 */
export type EntryFamily = "tags" | "sources" | "verified" | "parameters";

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
	superseded_by: Schema.optionalKey(Schema.String),
	integrity: Schema.optionalKey(Integrity),
	attested: Schema.optionalKey(AttestedComputation),
	entries: Schema.optionalKey(EntryPaths),
	extensions: Schema.Record(Schema.String, Schema.Unknown),
	raw: Schema.Record(Schema.String, Schema.Unknown),
}) {
	/**
	 * The YAML path of the `position`-th kept entry of a list family. Without recorded
	 * `entries` (a hand-built concept) it falls back to `[family, position]`, or `[family]`
	 * when `raw[family]` is not a list.
	 */
	static entryPath(concept: Concept, family: EntryFamily, position: number): ReadonlyArray<string | number> {
		const recorded = concept.entries?.[family]?.[position];
		if (recorded !== undefined) return recorded;
		return Array.isArray(concept.raw[family]) ? [family, position] : [family];
	}
}
