import type { StaleConcept } from "@okfit/core";
import { DateTime, Schema } from "effect";
import { ENGINE_VERSION } from "../version.js";
import type { Distribution } from "./distribution.js";
import { DistributionField } from "./distribution.js";

/** One entry of the `items` array. @public */
export const StaleItem = Schema.Struct({
	id: Schema.String,
	stale_after: Schema.String,
	days_past: Schema.Number,
});
/** @public */
export type StaleItem = typeof StaleItem.Type;

/** @public */
export const StaleSummary = Schema.Struct({
	concepts: Schema.Number,
	stale: Schema.Number,
});
/** @public */
export type StaleSummary = typeof StaleSummary.Type;

/**
 * `okfit stale --format json`'s envelope, schema 1, snake_case — the same
 * convention as `render/json.ts`'s `JsonEnvelope`. `as_of` and each item's
 * `stale_after` are `DateTime.formatIso` strings (mirrors
 * `packages/mcp/src/tools/staleReport.ts`). `stale` is always `0` (the
 * report never fails a run).
 *
 * @public
 */
export const StaleEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	engine_version: Schema.String,
	producer: Schema.String,
	distribution: DistributionField,
	okf_version: Schema.String,
	root: Schema.String,
	profile: Schema.NullOr(Schema.String),
	as_of: Schema.String,
	summary: StaleSummary,
	items: Schema.Array(StaleItem),
});
/** @public */
export type StaleEnvelope = typeof StaleEnvelope.Type;

/**
 * Build the envelope. `items` is `Derive.staleReport`'s output verbatim
 * (already sorted by id); this just reshapes it to snake_case and formats
 * the two `DateTime.Utc` fields.
 *
 * @public
 */
export const staleEnvelope = (input: {
	readonly okfitVersion: string;
	readonly producer: string;
	readonly okfVersion: string;
	readonly root: string;
	readonly profile: string | null;
	readonly now: DateTime.Utc;
	readonly concepts: number;
	readonly items: ReadonlyArray<StaleConcept>;
	readonly distribution?: Distribution;
}): StaleEnvelope => ({
	schema: 1,
	okfit_version: input.okfitVersion,
	engine_version: ENGINE_VERSION,
	producer: input.producer,
	distribution: input.distribution ?? null,
	okf_version: input.okfVersion,
	root: input.root,
	profile: input.profile,
	as_of: DateTime.formatIso(input.now),
	summary: { concepts: input.concepts, stale: input.items.length },
	items: input.items.map((item) => ({
		id: item.id,
		stale_after: DateTime.formatIso(item.staleAfter),
		days_past: item.daysPast,
	})),
});
