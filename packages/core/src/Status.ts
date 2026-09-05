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
