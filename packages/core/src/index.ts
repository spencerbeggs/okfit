/**
 * Spec-level Open Knowledge Format (OKF) support for Effect.
 *
 * @packageDocumentation
 */

export type { ActorForm } from "./Actor.js";
export { Actor } from "./Actor.js";
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
export { ATTESTED_COMPUTATION_TYPE, Concept } from "./Concept.js";
export { ConceptId } from "./ConceptId.js";
export type { LogEntry, RenderIndexOptions, StaleConcept } from "./Derive.js";
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
export type { GraphEdge, GraphLink, GraphNode, PathField } from "./Graph.js";
export { Graph, GraphNodeKind, LinkGraph } from "./Graph.js";
export { IndexDocument, IndexEntry, IndexSection } from "./IndexDocument.js";
export { LogDocument, LogGroup, LogItem } from "./LogDocument.js";
export type { OkfitConfigFields } from "./OkfitConfig.js";
export {
	FieldDeclaration,
	LintLevel,
	LintTable,
	OkfitConfig,
	OkfitConfigFile,
	StaleAfterDuration,
	TagDeclaration,
	TypeDeclaration,
	okfitConfigDocumentFields,
} from "./OkfitConfig.js";
export { Source, UsageWindow } from "./Source.js";
export { Status } from "./Status.js";
export { Timestamp } from "./Timestamp.js";
export type { ValidateOptions, ValidationReport } from "./Validate.js";
export { Validate } from "./Validate.js";
export { Verification } from "./Verification.js";

/**
 * The OKF specification version this package implements.
 *
 * @public
 */
export const OKF_SPEC_VERSION = "0.2" as const;
