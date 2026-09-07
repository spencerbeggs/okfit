import { assert, describe, it } from "@effect/vitest";
import { ConfigIssueRenderer } from "@effected/cli";
import { ConfigValidationError } from "@effected/config-file";
import { Option, Result, Runtime, Schema } from "effect";
import { CliError } from "effect/unstable/cli";
import {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	InitOverwriteError,
	VerifyConceptNotFoundError,
	VerifyUnsupportedFrontmatterError,
	renderFailure,
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

describe("renderFailure", () => {
	it("renders a ShowHelp as no lines (K-30: Command.runWith already printed the help)", () => {
		const showHelp = new CliError.ShowHelp({ commandPath: ["okfit"], errors: [] });
		assert.deepStrictEqual(renderFailure(showHelp), []);
	});

	it("renders ConfigPathNotFoundError as one error line", () => {
		const error = new ConfigPathNotFoundError({ path: "/abs/ci-config.toml" });
		assert.deepStrictEqual(renderFailure(error), ["error: config path not found: /abs/ci-config.toml"]);
	});

	it("renders ConfigMalformedError as one error line naming the path and the cause (K-46)", () => {
		const error = new ConfigMalformedError({ path: "/abs/ci-config.toml", cause: new Error("toml parse failed") });
		assert.deepStrictEqual(renderFailure(error), ["error: malformed config /abs/ci-config.toml: toml parse failed"]);
	});

	it("renders InitOverwriteError as the header, one indented path per conflict, and the footer, relativised to cwd", () => {
		const error = new InitOverwriteError({
			paths: ["/root/.config/okfit.toml", "/root/okf/index.md", "/elsewhere/stray.md"],
			cwd: "/root",
		});
		assert.deepStrictEqual(renderFailure(error), [
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
		assert.deepStrictEqual(renderFailure(error), expected);
	});

	it("renders any other error as a single error line", () => {
		assert.deepStrictEqual(renderFailure(new Error("boom")), ["error: Error: boom"]);
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
});

describe("renderFailure for the verify errors", () => {
	it("renders each as one lowercase error: line with no tag prefix (contract §12 note 6)", () => {
		const notFound = new VerifyConceptNotFoundError({
			id: "decisions/no-such-thing",
			root: "/abs/repo/okf",
			reason: "not-a-concept",
		});
		const unsupported = new VerifyUnsupportedFrontmatterError({ id: "decisions/alias-case", shape: "alias" });
		assert.deepStrictEqual(renderFailure(notFound), [
			'error: no concept "decisions/no-such-thing" in this bundle (not-a-concept)',
		]);
		assert.deepStrictEqual(renderFailure(unsupported), [
			'error: "decisions/alias-case"\'s verified value is a shape okfit verify cannot edit (alias); edit it by hand',
		]);
		// The discriminating control: without a dedicated branch the catch-all
		// would prefix the tag, which is exactly what these branches exist to
		// prevent.
		assert.isFalse(renderFailure(notFound)[0]?.includes("VerifyConceptNotFoundError"));
		assert.isFalse(renderFailure(unsupported)[0]?.includes("VerifyUnsupportedFrontmatterError"));
	});
});
