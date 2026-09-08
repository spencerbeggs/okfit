/**
 * Named okfit configuration profiles: derivation of `generated.at` and
 * `generated.by` from git, and the `software-project` profile's config,
 * layout, and bundle checks.
 *
 * @packageDocumentation
 */

export type { UncommittedReason } from "./BodyProvenance.js";
export { BodyCommitted, BodyProvenance, BodyUncommitted } from "./BodyProvenance.js";
export type {
	GeneratedAtError,
	GeneratedAtOptions,
	GeneratedByError,
	GeneratedByOptions,
	GitIdentity,
	Writer,
} from "./Derivation.js";
export { AgentActorUnconfiguredError, Derivation, HumanActorUnresolvedError } from "./Derivation.js";
export type { GitHistoryShape, PathLogOptions } from "./GitHistory.js";
export { GitHistory, GitHistoryError, PathHistoryEntry } from "./GitHistory.js";
export type { Layout, LayoutDirectory, Profile, ProfileName } from "./Profile.js";
export { PROFILE_NAMES, ProfileDiagnostic, ProfileDiagnosticCode } from "./Profile.js";
export { Profiles } from "./Profiles.js";
export { Provenance } from "./Provenance.js";
