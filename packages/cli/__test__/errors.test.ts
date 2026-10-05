import { assert, describe, it } from "@effect/vitest";
import { Cancelled, ConfigIssueRenderer, NotInteractive } from "@effected/cli";
import { ConfigValidationError } from "@effected/config-file";
import {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	DocumentPathError,
	InitOverwriteError,
	QueryConceptNotFoundError,
	QuerySelectionError,
	QueryUnknownVocabularyError,
	VerifyConceptNotFoundError,
	VerifyUnsupportedFrontmatterError,
} from "@okfit/engine";
import { Cause, Option, Result, Schema } from "effect";
import { renderFailure } from "../src/errors.js";
import { detailsOf, renderDefect, renderTyped } from "./utils/failureDetails.js";

describe("renderFailure", () => {
	it("renders the kit's Cancelled and NotInteractive as their own fixed line, unprefixed (#217)", () => {
		assert.deepStrictEqual(renderTyped(new Cancelled({ reason: "escape" })), ["cancelled; nothing written"]);
		assert.deepStrictEqual(renderTyped(new Cancelled({ reason: "interrupt" })), ["cancelled; nothing written"]);
		assert.deepStrictEqual(renderTyped(new NotInteractive({})), [
			"not interactive: run in a terminal or pass the flag",
		]);
	});

	it("renders ConfigPathNotFoundError as one error line", () => {
		const error = new ConfigPathNotFoundError({ path: "/abs/ci-config.toml" });
		assert.deepStrictEqual(renderTyped(error), ["error: config path not found: /abs/ci-config.toml"]);
	});

	it("renders ConfigMalformedError as one error line naming the path and the cause (K-46)", () => {
		const error = new ConfigMalformedError({ path: "/abs/ci-config.toml", cause: new Error("toml parse failed") });
		assert.deepStrictEqual(renderTyped(error), ["error: malformed config /abs/ci-config.toml: toml parse failed"]);
	});

	it("renders InitOverwriteError as the header, one indented path per conflict, and the footer, relativised to cwd", () => {
		const error = new InitOverwriteError({
			paths: ["/root/.config/okfit.toml", "/root/okf/index.md", "/elsewhere/stray.md"],
			cwd: "/root",
		});
		assert.deepStrictEqual(renderTyped(error), [
			"error: refusing to overwrite existing files:",
			"  .config/okfit.toml",
			"  okf/index.md",
			"  /elsewhere/stray.md",
			"Nothing was written.",
		]);
	});

	it("renders a ConfigValidationError as its own message plus one indented ConfigIssueRenderer line per issue", () => {
		const decoded = Schema.decodeUnknownResult(Schema.Struct({ a: Schema.String }))({ a: 42 });
		const issue = Result.isFailure(decoded)
			? decoded.failure.issue
			: (() => {
					throw new Error("expected the decode to fail");
				})();
		const error = new ConfigValidationError({ path: Option.none(), issue });
		const expected = [`error: ${String(error)}`, ...ConfigIssueRenderer.render(error).map((line) => `  ${line}`)];
		assert.deepStrictEqual(renderTyped(error), expected);
	});

	it("renders the okfit query errors as one error line, without the class name", () => {
		for (const error of [
			new QueryConceptNotFoundError({ id: "nope", reason: "not-a-concept" }),
			new QueryUnknownVocabularyError({ kind: "type", requested: "Nope", valid: ["Decision"] }),
			new QuerySelectionError({ reason: "verified-conflict" }),
		]) {
			assert.deepStrictEqual(renderTyped(error), [`error: ${error.message}`]);
		}
	});

	it("renders any other typed failure as a single error line, with no issue link", () => {
		assert.deepStrictEqual(renderTyped(new Error("boom")), ["error: Error: boom"]);
	});

	it("renders a defect as the kit's report plus the issue link", () => {
		const lines = renderDefect(new Error("boom"));
		assert.isTrue(lines[0]?.startsWith("error: "));
		assert.isTrue(lines[0]?.includes("boom"));
		assert.strictEqual(lines.at(-1), "Please report at https://github.com/spencerbeggs/okfit/issues");
	});

	it("keeps Cancelled unprefixed even though a cancel arrives as a defect", () => {
		const cancelled = new Cancelled({ reason: "escape" });
		assert.deepStrictEqual(renderFailure(cancelled, detailsOf(cancelled, Cause.die(cancelled), true)), [
			"cancelled; nothing written",
		]);
	});

	it("gives a known typed error its own line even when it arrives as a defect", () => {
		const error = new QuerySelectionError({ reason: "verified-conflict" });
		assert.deepStrictEqual(renderDefect(error), [`error: ${error.message}`]);
	});
});

describe("renderFailure for the verify errors", () => {
	it("renders each as one lowercase error: line with no tag prefix (contract §12 note 6)", () => {
		const notFound = new VerifyConceptNotFoundError({
			id: "decisions/no-such-thing",
			root: "/abs/repo/okf",
			reason: "not-a-concept",
		});
		const unsupported = new VerifyUnsupportedFrontmatterError({ id: "decisions/alias-case", shape: "alias" });
		assert.deepStrictEqual(renderTyped(notFound), [
			'error: no concept "decisions/no-such-thing" in this bundle (not-a-concept)',
		]);
		assert.deepStrictEqual(renderTyped(unsupported), [
			'error: "decisions/alias-case"\'s verified value is a shape okfit verify cannot edit (alias); edit it by hand',
		]);
		// The discriminating control: without a dedicated branch the catch-all
		// would prefix the tag, which is exactly what these branches exist to
		// prevent.
		assert.isFalse(renderTyped(notFound)[0]?.includes("VerifyConceptNotFoundError"));
		assert.isFalse(renderTyped(unsupported)[0]?.includes("VerifyUnsupportedFrontmatterError"));
	});

	it("renders DocumentPathError as one error line", () => {
		const error = new DocumentPathError({ path: "../x.md", reason: "escapes-bundle" });
		assert.deepStrictEqual(renderTyped(error), ['error: document path "../x.md" resolves outside the bundle root']);
	});
});
