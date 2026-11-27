import { assert, describe, it } from "@effect/vitest";
import * as Core from "../src/index.js";

const VALUES = [
	"Actor",
	"ActorPattern",
	"Timestamp",
	"GENERATED_AT_TOLERANCE",
	"generatedAtIsFuture",
	"verificationBlockingRestamp",
	"Source",
	"EntryPaths",
	"UsageWindow",
	"Generated",
	"Digest",
	"INTEGRITY_KEY",
	"OKFIT_KEY_PREFIX",
	"Integrity",
	"IntegrityGenerated",
	"IntegrityVerified",
	"Verification",
	"Status",
	"AttestedComputation",
	"ComputationAttester",
	"ComputationExecutor",
	"ComputationParameter",
	"ATTESTED_COMPUTATION_TYPE",
	"Concept",
	"ConceptId",
	"changedWhileRead",
	"ConfinementError",
	"readConfinedBytes",
	"readConfinedString",
	"ConformanceCode",
	"Diagnostic",
	"DiagnosticCode",
	"DiagnosticRange",
	"DiagnosticSeverity",
	"LintCode",
	"IndexDocument",
	"IndexEntry",
	"IndexSection",
	"LogDocument",
	"LogGroup",
	"LogItem",
	"Bundle",
	"BundleDepthExceededError",
	"BundleReadError",
	"BundleRootNotFoundError",
	"LoadedBundle",
	"LoadedConcept",
	"Graph",
	"GraphNodeKind",
	"LinkGraph",
	"Derive",
	"DerivedStatus",
	"OkfVersion",
	"Staleness",
	"TrustTier",
	"Validate",
	"FieldDeclaration",
	"LintLevel",
	"LintTable",
	"OkfitConfig",
	"okfitConfigDocumentFields",
	"okfitConfigSchemaHost",
	"CONFIG_SCHEMA_VERSION",
	"SCHEMA_DIRECTIVE",
	"OkfitConfigFile",
	"StaleAfterDuration",
	"TagDeclaration",
	"TypeDeclaration",
	"OKF_SPEC_VERSION",
] as const;

describe("@okfit/core", () => {
	it("targets OKF spec version 0.3", () => {
		assert.strictEqual(Core.OKF_SPEC_VERSION, "0.3");
	});
	it("declares the config schema's version as major.minor (okfit #137)", () => {
		assert.match(Core.CONFIG_SCHEMA_VERSION, /^\d+\.\d+$/);
	});
	it("exports exactly the contract's value surface", () => {
		assert.deepStrictEqual(Object.keys(Core).sort(), [...VALUES].sort());
	});
});
