/**
 * Spec-level Open Knowledge Format (OKF) support for Effect.
 *
 * @packageDocumentation
 */

export type { ActorForm } from "./Actor.js";
export { Actor, ActorPattern } from "./Actor.js";
export {
	AttestedComputation,
	ComputationAttester,
	ComputationExecutor,
	ComputationParameter,
} from "./AttestedComputation.js";
export type { BundleLoadError, BundleLoadOptions } from "./Bundle.js";
export {
	Bundle,
	BundleDepthExceededError,
	BundleReadError,
	BundleRootNotFoundError,
	LoadedBundle,
	LoadedConcept,
} from "./Bundle.js";
export type { EntryFamily } from "./Concept.js";
export { ATTESTED_COMPUTATION_TYPE, Concept, EntryPaths } from "./Concept.js";
export { ConceptId } from "./ConceptId.js";
export { ConfinementError, changedWhileRead, readConfinedBytes, readConfinedString } from "./ConfinedRead.js";
export type { LogEntry, MalformedStaleAfter, RenderIndexOptions, StaleConcept } from "./Derive.js";
export { Derive, Staleness, TrustTier } from "./Derive.js";
export {
	ConformanceCode,
	Diagnostic,
	DiagnosticCode,
	DiagnosticRange,
	DiagnosticSeverity,
	LintCode,
} from "./Diagnostic.js";
export { Generated } from "./Generated.js";
export {
	GENERATED_AT_TOLERANCE,
	GENERATED_AT_TOLERANCE_TEXT,
	generatedAtIsFuture,
	verificationBlockingRestamp,
} from "./GeneratedAtFuture.js";
export type { FallbackRule, GraphEdge, GraphLink, GraphNode, LinkResolution, PathField } from "./Graph.js";
export { Graph, GraphNodeKind, LinkGraph } from "./Graph.js";
export { IndexDocument, IndexEntry, IndexSection } from "./IndexDocument.js";
export {
	Digest,
	INTEGRITY_KEY,
	Integrity,
	IntegrityGenerated,
	IntegrityVerified,
	OKFIT_KEY_PREFIX,
} from "./Integrity.js";
export { LogDocument, LogGroup, LogItem } from "./LogDocument.js";
export type { OkfitConfigFields } from "./OkfitConfig.js";
export {
	CONFIG_SCHEMA_VERSION,
	FieldDeclaration,
	LintLevel,
	LintTable,
	OkfitConfig,
	OkfitConfigFile,
	SCHEMA_DIRECTIVE,
	StaleAfterDuration,
	TagDeclaration,
	TypeDeclaration,
	okfitConfigDocumentFields,
	okfitConfigSchemaHost,
} from "./OkfitConfig.js";
export type { OkfVersionNumber } from "./OkfVersion.js";
export { OkfVersion } from "./OkfVersion.js";
export { Source, UsageWindow } from "./Source.js";
export { DerivedStatus, Status } from "./Status.js";
export { Timestamp } from "./Timestamp.js";
export type { ValidateOptions, ValidationReport } from "./Validate.js";
export { Validate } from "./Validate.js";
export { Verification } from "./Verification.js";

/**
 * The OKF specification version this package implements.
 *
 * @public
 */
export const OKF_SPEC_VERSION = "0.3" as const;
