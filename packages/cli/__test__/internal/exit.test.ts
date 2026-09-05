import { assert, describe, it } from "@effect/vitest";
import { setExitCode } from "../../src/internal/exit.js";

describe("setExitCode", () => {
	it("writes process.exitCode and only process.exitCode (K-7)", () => {
		const original = process.exitCode;
		try {
			setExitCode(2);
			assert.strictEqual(process.exitCode, 2);
			setExitCode(1);
			assert.strictEqual(process.exitCode, 1);
			setExitCode(0);
			assert.strictEqual(process.exitCode, 0);
		} finally {
			process.exitCode = original;
		}
	});
});
