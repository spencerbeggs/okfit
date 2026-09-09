import { assert, describe, it } from "@effect/vitest";
import { Runtime } from "effect";
import {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	InitOverwriteError,
	VerifyConceptNotFoundError,
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
});
