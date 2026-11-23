import { Schema } from "effect";

/**
 * Concept lifecycle status. Absent on a concept means `stable` (`Derive.status`).
 * @public
 */
export const Status = Schema.Literals(["draft", "stable", "deprecated"]);

/**
 * The decoded status value.
 * @public
 */
export type Status = typeof Status.Type;

/**
 * What `Derive.status` reads: the three known values, or `unknown` for a `status` outside the
 * vocabulary (OKF 0.3 §5.4). `unknown` is never written; `Status` is the write vocabulary.
 * @public
 */
export const DerivedStatus = Schema.Literals(["draft", "stable", "deprecated", "unknown"]);

/**
 * The derived status value.
 * @public
 */
export type DerivedStatus = typeof DerivedStatus.Type;
