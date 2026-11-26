import { assert, describe, it } from "@effect/vitest";
import { ConfigValidationError } from "@effected/config-file";
import { OkfitConfig } from "@okfit/core";
import { Effect, Option, Runtime, Schema } from "effect";
import {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	InitOverwriteError,
	QueryConceptNotFoundError,
	QuerySelectionError,
	QueryUnknownVocabularyError,
	TargetResolutionError,
	VerifyConceptNotFoundError,
	VerifyNotCurrentError,
	VerifySelectionError,
	VerifyStatusUnknownError,
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

describe("ConfigMalformedError with a validation cause", () => {
	it.effect("names the failing key, not the generic validation text", () =>
		Effect.gen(function* () {
			const issue = (yield* Effect.flip(Schema.decodeUnknownEffect(OkfitConfig)({ lint: { missing_index: "loud" } })))
				.issue;
			const cause = new ConfigValidationError({ path: Option.some("/p/okfit.toml"), issue });
			const error = new ConfigMalformedError({ path: "/p/okfit.toml", cause });
			assert.isTrue(error.message.startsWith("malformed config /p/okfit.toml: lint.missing_index: "), error.message);
			assert.notInclude(error.message, "Config validation failed");
		}),
	);
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

describe("VerifyUnsupportedFrontmatterError legacy-key", () => {
	it("names the old key so a user can find it, and points at okfit sync", () => {
		const message = new VerifyUnsupportedFrontmatterError({ id: "a", shape: "legacy-key" }).message;
		assert.include(message, "old `integrity` block");
		assert.include(message, "`x-okfit-integrity`");
		assert.include(message, "okfit sync");
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
		assert.strictEqual(
			error.message,
			"--stable and --draft need targets that name exactly one concept; batch mode never changes status",
		);
	});
});

describe("VerifySelectionError status-needs-one-concept (#514)", () => {
	it("exits 64 and names the resolved count, without the batch tail", () => {
		const error = new VerifySelectionError({ reason: "status-needs-one-concept", detail: "2" });
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.strictEqual(error.message, "--stable and --draft need targets that name exactly one concept; these name 2");
	});
});

describe("VerifySelectionError at-malformed (#513)", () => {
	it("exits 64 and names the expected form, quoting the value as given", () => {
		const error = new VerifySelectionError({ reason: "at-malformed", detail: "tomorrow" });
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.strictEqual(
			error.message,
			'--at "tomorrow" is not a timestamp; give an ISO 8601 timestamp with an explicit offset (Z, +hh:mm or -hh:mm), such as 2026-11-25T12:00:00Z, or a date (YYYY-MM-DD, read as midnight UTC)',
		);
	});

	it("quotes an empty value so it still reads as a value (#513)", () => {
		const error = new VerifySelectionError({ reason: "at-malformed", detail: "" });
		assert.isTrue(error.message.startsWith('--at "" is not a timestamp; '), error.message);
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

	it("QuerySelectionError browse-needs-terminal exits 64 and points at the print commands (#227)", () => {
		const error = new QuerySelectionError({ reason: "browse-needs-terminal" });
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.strictEqual(error.message, "run in a terminal to browse interactively; use okfit query list/get/neighbors");
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

describe("TargetResolutionError", () => {
	it("exits 64 and renders one line per failure", () => {
		const error = new TargetResolutionError({
			failures: [{ arg: "foo.md", reason: "ambiguous", candidates: ["decisions/foo.md", "foo.md"] }],
		});
		assert.strictEqual(error[Runtime.errorExitCode], 64);
		assert.strictEqual(
			error.message,
			'"foo.md" is ambiguous: it names both decisions/foo.md and foo.md; pass an id or an absolute path',
		);
	});
});

describe("VerifyStatusUnknownError", () => {
	it("carries exit code 3 and names the raw status and the way out", () => {
		const error = new VerifyStatusUnknownError({ id: "metrics/margin", status: "bogus" });
		assert.strictEqual(error[Runtime.errorExitCode], 3);
		assert.strictEqual(
			error.message,
			'"metrics/margin" has status "bogus", which is not draft, stable or deprecated; fix the status (or pass --stable or --draft) before verifying',
		);
	});
});

describe("VerifyNotCurrentError", () => {
	it("words the refusal by how far ahead the stamp is: future, near-future, or a backdated verification time", () => {
		const fields = { id: "metrics/margin", at: "2026-09-16T11:59:59Z", generatedAt: "2030-01-01T00:00:00Z" };
		assert.strictEqual(
			new VerifyNotCurrentError({ ...fields, kind: "future" }).message,
			'"metrics/margin" has generated.at 2030-01-01T00:00:00Z, which is more than 5 minutes later than now, so no verification made now would count (OKF 0.3 §5.3). Commit any change to its body, then run okfit sync, which re-stamps it, then verify again',
		);
		assert.strictEqual(
			new VerifyNotCurrentError({ ...fields, kind: "near-future" }).message,
			'"metrics/margin" has generated.at 2030-01-01T00:00:00Z, which is later than now by less than 5 minutes, so no verification made now would count yet (OKF 0.3 §5.3). Check the clock, or verify again at or after 2030-01-01T00:00:00Z',
		);
		assert.strictEqual(
			new VerifyNotCurrentError({ ...fields, kind: "blocked", blockedBy: "2029-01-01T00:00:00Z" }).message,
			'"metrics/margin" has generated.at 2030-01-01T00:00:00Z, which is later than now, so no verification made now would count (OKF 0.3 §5.3). okfit sync will not re-stamp it, because the verification dated 2029-01-01T00:00:00Z would then count without a re-verification; a human must correct generated.at or that verification',
		);
		assert.strictEqual(
			new VerifyNotCurrentError(fields).message,
			'"metrics/margin" was last changed at 2030-01-01T00:00:00Z, after the verification time 2026-09-16T11:59:59Z; a verification before the last change does not count (OKF 0.3 §5.3). Verify at or after 2030-01-01T00:00:00Z, or omit --at to verify now',
		);
	});

	it("carries exit code 3 and names both instants and the fix", () => {
		const error = new VerifyNotCurrentError({
			id: "metrics/margin",
			at: "2026-09-16T11:59:59Z",
			generatedAt: "2026-09-16T12:00:00Z",
		});
		assert.strictEqual(error[Runtime.errorExitCode], 3);
		assert.strictEqual(
			error.message,
			'"metrics/margin" was last changed at 2026-09-16T12:00:00Z, after the verification time 2026-09-16T11:59:59Z; a verification before the last change does not count (OKF 0.3 §5.3). Verify at or after 2026-09-16T12:00:00Z, or omit --at to verify now',
		);
	});
});
