import { assert, describe, it } from "@effect/vitest";
import { ToolFailure, ToolRefusal } from "@effected/mcp";

describe("ToolFailure.message (@effected/mcp)", () => {
	it("appends the hint alone when no suggestedTool is given", () => {
		assert.strictEqual(
			ToolFailure.message("toml parse failed", { hint: "check the syntax" }),
			"toml parse failed check the syntax",
		);
	});

	it("appends the hint and a Try <suggestedTool> sentence when suggestedTool is given", () => {
		assert.strictEqual(
			ToolFailure.message("toml parse failed", { hint: "check the syntax", suggestedTool: "describe_vocabulary" }),
			"toml parse failed check the syntax Try describe_vocabulary.",
		);
	});

	it("is what ToolRefusal.refuse carries as its own message", () => {
		const remediation = { hint: "check the syntax", suggestedTool: "describe_vocabulary" };
		const error = ToolRefusal.refuse("toml parse failed", remediation);
		assert.strictEqual(error.message, "toml parse failed check the syntax Try describe_vocabulary.");
		assert.deepStrictEqual(error.remediation, remediation);
	});
});

describe("ToolFailure.truncate (@effected/mcp)", () => {
	it("leaves a value at or under the limit unchanged", () => {
		assert.strictEqual(ToolFailure.truncate("decisions/cli-exit-codes"), "decisions/cli-exit-codes");
	});

	it("truncates a 5,000-character id to 200 characters plus an ellipsis", () => {
		const id = "a".repeat(5000);
		const truncated = ToolFailure.truncate(id);
		assert.strictEqual(truncated, `${"a".repeat(200)}…`);
		assert.strictEqual(truncated.length, 201);
	});
});
