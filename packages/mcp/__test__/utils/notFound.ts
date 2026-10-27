import { assert } from "@effect/vitest";

/** The `ok: false` envelope `get_concept` and `concept_neighbors` answer for an id that names no concept. */
interface NotFoundEnvelope {
	readonly ok: false;
	readonly error: {
		readonly _tag: string;
		readonly id: string;
		readonly reason: string;
		readonly message: string;
		readonly remediation: { readonly hint: string; readonly suggestedTool?: string };
	};
}

/**
 * Asserts `result` is the not-found envelope on the success channel: not
 * `isError`, `structuredContent.ok` false, the engine's tag, `id` and
 * `reason`, a message containing `messageIncludes`, and a remediation that
 * points at `list_concepts`.
 */
export const assertConceptNotFound = (
	result: { readonly isError?: boolean | undefined; readonly structuredContent?: unknown },
	expected: { readonly id: string; readonly reason: "empty-id" | "not-a-concept"; readonly messageIncludes: string },
): void => {
	assert.notStrictEqual(result.isError, true);
	const data = result.structuredContent as NotFoundEnvelope;
	assert.strictEqual(data.ok, false);
	assert.strictEqual(data.error._tag, "QueryConceptNotFoundError");
	assert.strictEqual(data.error.id, expected.id);
	assert.strictEqual(data.error.reason, expected.reason);
	assert.ok(data.error.message.includes(expected.messageIncludes));
	assert.strictEqual(data.error.remediation.suggestedTool, "list_concepts");
};
