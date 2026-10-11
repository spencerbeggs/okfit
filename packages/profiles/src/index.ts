/**
 * Named okfit configuration profiles: derivation of `generated.at` and
 * `generated.by` from git, and the `software-project` profile's config,
 * layout, and bundle checks.
 *
 * @packageDocumentation
 */

export type { UncommittedReason } from "./BodyProvenance.js";
export { BodyCommitted, BodyProvenance, BodyUncommitted } from "./BodyProvenance.js";
export { Canonical } from "./Canonical.js";
export type {
	GeneratedAtError,
	GeneratedAtOptions,
	GeneratedByError,
	GeneratedByOptions,
	GitIdentity,
	VerifierError,
	Writer,
} from "./Derivation.js";
export {
	ActorConfigInvalidError,
	AgentActorUnconfiguredError,
	Derivation,
	HumanActorNotAllowedError,
	HumanActorUnresolvedError,
} from "./Derivation.js";
export type { GitHistoryShape, PathLogOptions } from "./GitHistory.js";
export { GitHistory, GitHistoryError, PathHistoryEntry } from "./GitHistory.js";
export type { DocsPreset, Layout, LayoutDirectory, Profile, ProfileName, SurfaceTemplate } from "./Profile.js";
export { PROFILE_NAMES, ProfileDiagnostic, ProfileDiagnosticCode } from "./Profile.js";
export { Profiles } from "./Profiles.js";
export { Provenance } from "./Provenance.js";
export type { RendersEntry } from "./Publications.js";
export { PUBLICATION_TYPE, Publications, SURFACE_TYPE } from "./Publications.js";
export type { ConceptSignal, DriftReason, EvaluateInput, IntegrityState } from "./Trust.js";
export { Trust } from "./Trust.js";
