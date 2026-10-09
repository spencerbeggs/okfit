import { assert, describe, it } from "@effect/vitest";
import { Runtime } from "effect";
import {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	InitOverwriteError,
	QueryConceptNotFoundError,
	QuerySelectionError,
	QueryUnknownVocabularyError,
	VerifyConceptNotFoundError,
	VerifySelectionError,
	VerifyUnsupportedFrontmatterError,
} from "../src/errors.js";

describe("ConfigPathNotFoundError", () => {
	it("carries exit code 3 and names the path", () => {
		const error = new ConfigPathNotFoundError({ path: "/abs/ci-config.toml" });
		assert.strictEqual(error[Runtime.errorExitCode], 3);
		assert.strictEqual(error.message, "config path not found: /abs/ci-config.toml");
	});
});

describe("InitOverwriteError", () => {
	it("carries exit code 3 and a fixed message; paths render separately", () => {
		const error = new InitOverwriteError({ paths: ["/root/okf/index.md"], cwd: "/root" });
		assert.strictEqual(error[Runtime.errorExitCode], 3);
		assert.strictEqual(error.message, "refusing to overwrite existing files");
	});
});

describe("ConfigMalformedError", () => {
	it("carries exit code 3 and names the path and the cause (K-46)", () => {
		const error = new ConfigMalformedError({ path: "/abs/ci-config.toml", cause: new Error("toml parse failed") });
		assert.strictEqual(error[Runtime.errorExitCode], 3);
		assert.strictEqual(error.message, "malformed config /abs/ci-config.toml: toml parse failed");
	});
});

describe("VerifyConceptNotFoundError", () => {
	it("carries exit code 3 and names the id and the reason", () => {
		const error = new VerifyConceptNotFoundError({
			id: "decisions/no-such-thing",
			root: "/abs/repo/okf",
			reason: "not-a-concept",
		});
		assert.strictEqual(error[Runtime.errorExitCode], 3);
		assert.strictEqual(error.message, 'no concept "decisions/no-such-thing" in this bundle (not-a-concept)');
	});

	it("folds the diagnostic code into the message for the undecodable reason (V-9)", () => {
		const error = new VerifyConceptNotFoundError({
			id: "decisions/broken",
			root: "/abs/repo/okf",
			reason: "undecodable",
			diagnosticCode: "frontmatter-unparseable",
		});
		assert.strictEqual(
			error.message,
			'no concept "decisions/broken" in this bundle (undecodable: frontmatter-unparseable)',
		);
	});

	it("keeps the bundle root off the message so K-51 has nothing to relativise", () => {
		const error = new VerifyConceptNotFoundError({ id: "index", root: "/abs/repo/okf", reason: "reserved" });
		assert.strictEqual(error.root, "/abs/repo/okf");
		assert.isFalse(error.message.includes("/abs/repo/okf"));
		assert.strictEqual(error.message, 'no concept "index" in this bundle (reserved)');
	});
});

describe("VerifyUnsupportedFrontmatterError", () => {
	it("carries exit code 3 and tells the human to edit by hand (V-14)", () => {
		const error = new VerifyUnsupportedFrontmatterError({ id: "decisions/alias-case", shape: "alias" });
		assert.strictEqual(error[Runtime.errorExitCode], 3);
		assert.strictEqual(
			error.message,
			'"decisions/alias-case"\'s verified value is a shape okfit verify cannot edit (alias); edit it by hand',
		);
	});

	it("names status when key is status, and verified when key is omitted", () => {
		const error = new VerifyUnsupportedFrontmatterError({ id: "decisions/x", shape: "scalar", key: "status" });
		assert.strictEqual(
			error.message,
			'"decisions/x"\'s status value is a shape okfit verify cannot edit (scalar); edit it by hand',
		);
		const plain = new VerifyUnsupportedFrontmatterError({ id: "decisions/x", shape: "scalar" });
		assert.isTrue(plain.message.includes("verified value"));
	});
});

describe("VerifySelectionError status reasons (#185)", () => {
	it("status-conflict exits 64 and names both flags", () => {
		const error = new VerifySelectionError({ reason: "status-conflict" });
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.strictEqual(error.message, "verify takes --stable or --draft, not both");
	});

	it("status-and-batch exits 64 and explains batch mode never changes status", () => {
		const error = new VerifySelectionError({ reason: "status-and-batch" });
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.strictEqual(error.message, "--stable and --draft need a concept id; batch mode never changes status");
	});
});

describe("query errors", () => {
	it("QueryUnknownVocabularyError exits 64 and lists declared names", () => {
		const error = new QueryUnknownVocabularyError({ kind: "tag", requested: "zz", valid: ["a", "b"] });
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.strictEqual(error.message, 'tag "zz" is not declared in the config; declared: a, b');
	});

	it("QueryConceptNotFoundError exits 3 with a reason-specific message", () => {
		const empty = new QueryConceptNotFoundError({ id: "", reason: "empty-id" });
		assert.strictEqual(empty[Runtime.errorExitCode], 3);
		assert.strictEqual(empty.message, "a concept id must not be empty");
		assert.strictEqual(
			new QueryConceptNotFoundError({ id: "x", reason: "not-a-concept" }).message,
			'no concept "x" in this bundle',
		);
	});

	it("QuerySelectionError exits 64", () => {
		const error = new QuerySelectionError({ reason: "verified-conflict" });
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.strictEqual(error.message, "query list takes --verified or --unverified, not both");
	});
});

describe("VerifySelectionError dry-run-needs-verify (#228)", () => {
	it("exits 64 and says --dry-run needs --verify", () => {
		const error = new VerifySelectionError({ reason: "dry-run-needs-verify" });
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.include(error.message, "--dry-run needs --verify");
	});
});

describe("VerifySelectionError no-selection", () => {
	it("exits 64 and hints at the interactive picker", () => {
		const error = new VerifySelectionError({ reason: "no-selection" });
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.strictEqual(
			error.message,
			"verify needs a concept id, --all, or --type <Type> (run in a terminal to pick interactively)",
		);
	});
});
