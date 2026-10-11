import { Schema } from "effect";
import { ENGINE_VERSION } from "../version.js";
import type { Distribution } from "./distribution.js";
import { DistributionField } from "./distribution.js";

/**
 * `okfit mv`'s success envelope, schema 1, snake_case. `from`/`to` are bundle-relative paths, `path`
 * the display form of the destination; `edits` lists every file that changes (post-move path) with
 * its edit count, and `drifts` the ids whose current human verification the move invalidates.
 *
 * @public
 */
export const MoveEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	engine_version: Schema.String,
	distribution: DistributionField,
	from: Schema.String,
	to: Schema.String,
	path: Schema.String,
	dry_run: Schema.Boolean,
	edits: Schema.Array(Schema.Struct({ path: Schema.String, count: Schema.Number })),
	drifts: Schema.Array(Schema.String),
	exit_code: Schema.Literal(0),
});
/** @public */
export type MoveEnvelope = typeof MoveEnvelope.Type;

/**
 * `path` is already the display form, as for the other envelope builders.
 *
 * @public
 */
export const moveEnvelope = (input: {
	readonly okfitVersion: string;
	readonly from: string;
	readonly to: string;
	readonly path: string;
	readonly dryRun: boolean;
	readonly edits: ReadonlyArray<{ readonly path: string; readonly count: number }>;
	readonly drifts: ReadonlyArray<string>;
	readonly distribution?: Distribution;
}): MoveEnvelope => ({
	schema: 1,
	okfit_version: input.okfitVersion,
	engine_version: ENGINE_VERSION,
	distribution: input.distribution ?? null,
	from: input.from,
	to: input.to,
	path: input.path,
	dry_run: input.dryRun,
	edits: input.edits.map(({ path, count }) => ({ path, count })),
	drifts: input.drifts,
	exit_code: 0,
});
