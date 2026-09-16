import { Schema } from "effect";

/**
 * The meta-package an okfit report's bins were installed through -- e.g.
 * `@okfit/plugin` -- threaded into `main(options)` by that package's bin
 * shims (okfit #137). `null` for a direct install of `@okfit/cli` or
 * `@okfit/mcp`. This is packaging metadata, not a number to compare across
 * reports; `engine_version` and `okf_version` are the pair a reader
 * compares.
 *
 * @public
 */
export interface Distribution {
	readonly name: string;
	readonly version: string;
}

/** Every envelope's `distribution` field: a `Distribution` or `null`. @public */
export const DistributionField = Schema.NullOr(Schema.Struct({ name: Schema.String, version: Schema.String }));
/** @public */
export type DistributionField = typeof DistributionField.Type;
