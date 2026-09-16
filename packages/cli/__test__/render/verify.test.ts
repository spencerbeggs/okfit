import { assert, describe, it } from "@effect/vitest";
import { humanVerify, humanVerifyBatch } from "../../src/render/verify.js";

describe("humanVerify", () => {
	it("renders the success line, with a would-write preview under --dry-run", () => {
		const lines = humanVerify({
			id: "project",
			by: "human:ada",
			at: "2026-09-16T12:00:00Z",
			priorAt: [],
			dryRun: false,
			fragment: "verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n",
		});
		assert.deepStrictEqual(lines, ["verified project by human:ada at 2026-09-16T12:00:00Z"]);
	});
});

describe("humanVerifyBatch", () => {
	it("renders one verified fragment plus a draft skip and the trailing tally under --dry-run (#138)", () => {
		const lines = humanVerifyBatch({
			by: "human:ada",
			at: "2026-09-16T12:00:00Z",
			dryRun: true,
			verified: [
				{
					id: "decisions/a",
					fragment: "verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n",
				},
			],
			skipped: [{ id: "decisions/d", reason: "draft" }],
		});
		assert.deepStrictEqual(lines, [
			"skipped decisions/d: draft",
			"would verify decisions/a by human:ada at 2026-09-16T12:00:00Z",
			"would write:",
			"  verified:",
			"    - by: human:ada",
			"      at: 2026-09-16T12:00:00Z",
			"would verify 1, skipped 1 (dry run, nothing written)",
		]);
	});

	it("renders already-verified skips and the real-run tally when not a dry run", () => {
		const lines = humanVerifyBatch({
			by: "human:ada",
			at: "2026-09-16T12:00:00Z",
			dryRun: false,
			verified: [{ id: "decisions/a", fragment: "verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n" }],
			skipped: [{ id: "decisions/b", reason: "already-verified" }],
		});
		assert.deepStrictEqual(lines, [
			"skipped decisions/b: already verified by human:ada",
			"verified decisions/a by human:ada at 2026-09-16T12:00:00Z",
			"verified 1, skipped 1",
		]);
	});
});
