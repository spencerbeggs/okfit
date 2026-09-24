import type { Distribution as KitDistribution } from "@effected/engine";
import { DistributionField as KitDistributionField } from "@effected/engine";

/**
 * The meta-package an okfit report's bins were installed through -- e.g.
 * `@okfit/plugin` -- threaded into `main(options)` by that package's bin
 * shims (okfit #137). `null` for a direct install of `@okfit/cli` or
 * `@okfit/mcp`. This is packaging metadata, not a number to compare across
 * reports; `engine_version` and `okf_version` are the pair a reader
 * compares.
 *
 * Re-exported from `@effected/engine`'s own `Distribution` -- the shape
 * both `@okfit/cli`'s `CurrentDistribution` (K-137/carrier-version-threading)
 * and every JSON envelope in this package agree on, instead of two
 * independently hand-rolled `{ name, version }` structs drifting apart.
 *
 * @public
 */
export type Distribution = KitDistribution;

/** Every envelope's `distribution` field: a `Distribution` or `null`. @public */
export const DistributionField = KitDistributionField;
/** @public */
export type DistributionField = typeof DistributionField.Type;
