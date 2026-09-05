import { assert, describe, it } from "@effect/vitest";
import { ConfigIssueRenderer } from "@effected/cli";
import { ConfigValidationError } from "@effected/config-file";
import { Option, Result, Runtime, Schema } from "effect";
import { ConfigPathNotFoundError, InitOverwriteError, renderFailure } from "../src/errors.js";

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
		assert.deepStrictEqual(renderFailure({ _tag: "ShowHelp" }), []);
	});

	it("renders ConfigPathNotFoundError as one error line", () => {
		const error = new ConfigPathNotFoundError({ path: "/abs/ci-config.toml" });
		assert.deepStrictEqual(renderFailure(error), ["error: config path not found: /abs/ci-config.toml"]);
	});

	it("renders InitOverwriteError as the header, one indented path per conflict, and the footer, relativised to cwd", () => {
		const error = new InitOverwriteError({
			paths: ["/root/.config/okfit/config.toml", "/root/okf/index.md", "/elsewhere/stray.md"],
			cwd: "/root",
		});
		assert.deepStrictEqual(renderFailure(error), [
			"error: refusing to overwrite existing files:",
			"  .config/okfit/config.toml",
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
