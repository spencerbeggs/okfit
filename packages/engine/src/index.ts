/**
 * The okfit engine: config discovery and the validate, verify, sync, init
 * and context programs shared by the okfit CLI and the okfit MCP server.
 *
 * @packageDocumentation
 */

// OkfitPlatform's services, re-exported so a front end's inferred command types
// can name them through this package (TS 7.1 TS2883).
export type { AppDirs, Xdg, XdgEnvError } from "@effected/xdg";
export type { DiscoveredConfig } from "./config/anchor.js";
export { resolveBundleRoot, resolveProjectRoot } from "./config/anchor.js";
export { buildConfigLayer, provideConfig } from "./config/layer.js";
export type { ResolveProjectConfigInput, ResolvedProjectConfig } from "./config/resolve.js";
export { DEFAULT_PROFILE_NAME, resolveProjectConfig } from "./config/resolve.js";
export type { ContextResult, ContextRunOptions } from "./context/run.js";
export { runContext } from "./context/run.js";
export { FrontmatterEdits, UnsupportedFrontmatterError } from "./edits/FrontmatterEdits.js";
export {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	DocumentPathError,
	InitOverwriteError,
	MoveError,
	QueryConceptNotFoundError,
	QuerySelectionError,
	QueryUnknownVocabularyError,
	SyncPlanStaleError,
	SyncPublicationConflictError,
	TargetFailure,
	TargetResolutionError,
	VerifyConceptNotFoundError,
	VerifyNothingToRevokeError,
	VerifySelectionError,
	VerifyUnsupportedFrontmatterError,
} from "./errors.js";
export type { ExternalReferencesShape } from "./external/ExternalReferences.js";
export { ExternalReferences, ReferenceCheck, ReferenceState } from "./external/ExternalReferences.js";
export type { GraphRunOptions, GraphRunResult } from "./graph/run.js";
export { runGraph } from "./graph/run.js";
export type { ScaffoldFile, ScaffoldOptions } from "./init/scaffold.js";
export { CONFIG_RELATIVE_PATH, configValue, files, targetPaths } from "./init/scaffold.js";
export type { Reference, UnlocatableReference } from "./move/references.js";
export { referencesOf, rewriteReference } from "./move/references.js";
export type { MovePlan, PlanError, PlanMoveOptions, RunMoveOptions } from "./move/run.js";
export { planMove, runMove } from "./move/run.js";
export type { DocumentInput } from "./overlay/documents.js";
export { provideDocuments, resolveDocumentPath } from "./overlay/documents.js";
export type { OverlayDocument, OverlayDocumentsShape } from "./overlay/layer.js";
export { OverlayDocuments, layerOverlayFileSystem, makeOverlayFileSystem } from "./overlay/layer.js";
export { OkfitPlatform } from "./platform.js";
export type { ConceptFilter, ConceptLink, ConceptNeighbor } from "./query/ConceptQuery.js";
export { ConceptQuery } from "./query/ConceptQuery.js";
export {
	ContextEnvelope,
	ContextField,
	ContextFieldValue,
	ContextTag,
	ContextTrust,
	ContextType,
	contextEnvelope,
} from "./render/context.js";
export type { Distribution } from "./render/distribution.js";
export { DistributionField } from "./render/distribution.js";
export type { Tally } from "./render/exit.js";
export { forDiagnostics, tally } from "./render/exit.js";
export {
	GraphEdgeEnvelope,
	GraphEnvelope,
	GraphNodeEnvelope,
	GraphSummary,
	graphEnvelope,
} from "./render/graph.js";
export { JsonDiagnostic, JsonEnvelope, JsonErrorEnvelope, JsonSummary, json, jsonError } from "./render/json.js";
export { MoveEnvelope, moveEnvelope } from "./render/move.js";
export {
	ConceptSummary,
	QueryGetEnvelope,
	QueryLink,
	QueryListEnvelope,
	QueryNeighbor,
	QueryNeighborsEnvelope,
	TrustDrift,
	queryGetEnvelope,
	queryListEnvelope,
	queryNeighborsEnvelope,
	signalFor,
	toConceptSummary,
	toTrustDrift,
} from "./render/query.js";
export type { DiagnosticSource, RenderedDiagnostic } from "./render/sort.js";
export { collect, sort } from "./render/sort.js";
export { StaleEnvelope, StaleItem, StaleSummary, staleEnvelope } from "./render/stale.js";
export { PublicationEnvelope, SyncEnvelope, SyncModeEnvelope, syncEnvelope } from "./render/sync.js";
export {
	RevokeEnvelope,
	VerifyBatchEnvelope,
	VerifyEnvelope,
	revokeEnvelope,
	verifyBatchEnvelope,
	verifyEnvelope,
} from "./render/verify.js";
export type {
	BundleSessionOptions,
	BundleSessionServices,
	BundleSessionShape,
	RevalidateError,
	RevalidateOptions,
	RevalidateResult,
	RevalidateTier,
	WatchedFilesOutcome,
} from "./session/BundleSession.js";
export { BundleSession } from "./session/BundleSession.js";
export { conceptFor } from "./session/concept.js";
export { withFallbackRange } from "./session/range.js";
export type { StaleRunOptions, StaleRunResult } from "./stale/run.js";
export { runStale } from "./stale/run.js";
export { NotAPublicationError, PublicationNotFoundError, stampPublication } from "./sync/publication.js";
export type { SyncMode, SyncModeResult, SyncOptions, SyncPlan, SyncResult } from "./sync/run.js";
export { SkipReason, applySyncPlan, planSync, runSync } from "./sync/run.js";
export type { PendingWrite } from "./sync/write.js";
export type { ResolvedTarget } from "./targets/resolve.js";
export { Targets } from "./targets/resolve.js";
export type { ContextTrustOptions } from "./trust/run.js";
export { runContextTrust } from "./trust/run.js";
export type { RunOptions, RunResult } from "./validate/run.js";
export { Now, run } from "./validate/run.js";
export type { ChangeSince } from "./verify/diff.js";
export { changeSince } from "./verify/diff.js";
export type {
	DriftInspection,
	PickerCandidatesOptions,
	RevokeIdsOptions,
	RevokeOptions,
	RevokeResult,
	VerifyBatchOptions,
	VerifyBatchResult,
	VerifyBatchSkipReason,
	VerifyIdsOptions,
	VerifyOptions,
	VerifyResult,
} from "./verify/run.js";
export {
	inspectDrift,
	loadPickerCandidates,
	loadPreviews,
	loadStaleCandidates,
	runRevoke,
	runRevokeIds,
	runVerify,
	runVerifyBatch,
	runVerifyIds,
} from "./verify/run.js";
export type { AttestableSelection, PickerCandidate } from "./verify/select.js";
export { resolveBatchTypes, selectAttestable, selectPickerCandidates, selectStaleCandidates } from "./verify/select.js";
export { ENGINE_VERSION } from "./version.js";
