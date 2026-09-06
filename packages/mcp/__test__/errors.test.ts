import { assert, describe, it } from "@effect/vitest";
import { ConfigError, composeRemediatedMessage } from "../src/index.js";

describe("composeRemediatedMessage", () => {
	it("appends the hint alone when no suggestedTool is given", () => {
		assert.strictEqual(
			composeRemediatedMessage("toml parse failed", { hint: "check the syntax" }),
			"toml parse failed check the syntax",
		);
	});

	it("appends the hint and a Try <suggestedTool> sentence when suggestedTool is given", () => {
		assert.strictEqual(
			composeRemediatedMessage("toml parse failed", { hint: "check the syntax", suggestedTool: "describe_vocabulary" }),
			"toml parse failed check the syntax Try describe_vocabulary.",
		);
	});

	it("is what a constructed McpToolError member carries as its own message", () => {
		const remediation = { hint: "check the syntax", suggestedTool: "describe_vocabulary" };
		const error = new ConfigError({
			message: composeRemediatedMessage("toml parse failed", remediation),
			remediation,
		});
		assert.strictEqual(error.message, "toml parse failed check the syntax Try describe_vocabulary.");
		assert.deepStrictEqual(error.remediation, remediation);
	});
});
