/**
 * Spec-level Open Knowledge Format (OKF) support for Effect.
 *
 * @packageDocumentation
 */

export type { ActorForm } from "./Actor.js";
export { Actor } from "./Actor.js";
export { Timestamp } from "./Timestamp.js";

/**
 * The OKF specification version this package implements.
 *
 * @public
 */
export const OKF_SPEC_VERSION = "0.2" as const;
