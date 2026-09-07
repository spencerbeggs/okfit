import { assert, describe, it } from "@effect/vitest";
import * as Core from "../src/index.js";

const VALUES = [
	"Actor",
	"Timestamp",
	"Source",
	"UsageWindow",
	"Generated",
	"Verification",
	"Status",
	"AttestedComputation",
	"ComputationAttester",
	"ComputationExecutor",
	"ComputationParameter",
	"ATTESTED_COMPUTATION_TYPE",
	"Concept",
	"ConceptId",
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
	"BundleReadError",
	"BundleRootNotFoundError",
	"LoadedBundle",
	"LoadedConcept",
	"Graph",
	"GraphNodeKind",
	"LinkGraph",
	"Derive",
	"Staleness",
	"TrustTier",
	"Validate",
	"FieldDeclaration",
	"LintLevel",
	"LintTable",
	"OkfitConfig",
	"okfitConfigDocumentFields",
	"OkfitConfigFile",
	"StaleAfterDuration",
	"TagDeclaration",
	"TypeDeclaration",
	"OKF_SPEC_VERSION",
] as const;

describe("@okfit/core", () => {
	it("targets OKF spec version 0.2", () => {
		assert.strictEqual(Core.OKF_SPEC_VERSION, "0.2");
	});
	it("exports exactly the contract's value surface", () => {
		assert.deepStrictEqual(Object.keys(Core).sort(), [...VALUES].sort());
	});
});
