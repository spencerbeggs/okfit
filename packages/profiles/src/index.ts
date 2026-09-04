/**
 * Named okfit configuration profiles.
 *
 * @packageDocumentation
 */

/**
 * Names of the profiles this package ships.
 *
 * @public
 */
export const PROFILE_NAMES = ["software-project"] as const;

/**
 * A profile name shipped by this package.
 *
 * @public
 */
export type ProfileName = (typeof PROFILE_NAMES)[number];
