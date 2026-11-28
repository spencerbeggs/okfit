import { assert, describe, it } from "@effect/vitest";
import { Duration } from "effect";
import { GENERATED_AT_TOLERANCE, GENERATED_AT_TOLERANCE_TEXT } from "../src/GeneratedAtFuture.js";

describe("GENERATED_AT_TOLERANCE_TEXT", () => {
	it("names the tolerance in words (#506)", () => {
		assert.strictEqual(GENERATED_AT_TOLERANCE_TEXT, "5 minutes");
		assert.strictEqual(GENERATED_AT_TOLERANCE_TEXT, `${Duration.toMinutes(GENERATED_AT_TOLERANCE)} minutes`);
	});
});
