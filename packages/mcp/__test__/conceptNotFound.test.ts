import { assert, describe, it } from "@effect/vitest";
import { QueryConceptNotFoundError } from "@okfit/engine";
import { conceptNotFound } from "../src/internal/conceptNotFound.js";

describe("conceptNotFound", () => {
	it("answers a concept the load dropped as changed with the transient wording, not 'no concept' (Q12)", () => {
		const answer = conceptNotFound(
			"/metrics/revenue.md",
			new QueryConceptNotFoundError({ id: "metrics/revenue", reason: "changed-during-read" }),
		);
		assert.strictEqual(answer.reason, "changed-during-read");
		assert.strictEqual(answer.message, "metrics/revenue.md changed while it was read; try again");
		assert.notInclude(answer.message, "no concept");
		assert.include(answer.remediation.hint, "Call the tool again");
	});

	it("still answers an unknown id as not found, pointing at list_concepts", () => {
		const answer = conceptNotFound("nope", new QueryConceptNotFoundError({ id: "nope", reason: "not-a-concept" }));
		assert.strictEqual(answer.message, 'no concept "nope" in this bundle');
		assert.strictEqual(answer.remediation.suggestedTool, "list_concepts");
	});
});
