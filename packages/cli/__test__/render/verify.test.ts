import { assert, describe, it } from "@effect/vitest";
import { Render } from "@effected/cli";
import { humanVerify, humanVerifyBatch, humanVerifyBatchDoc, humanVerifyDoc } from "../../src/render/verify.js";

describe("humanVerify", () => {
	it("renders the success line, with a would-write preview under --dry-run", () => {
		const lines = humanVerify({
			id: "project",
			by: "human:ada",
			at: "2026-09-16T12:00:00Z",
			priorAt: [],
			dryRun: false,
			fragment: "verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n",
			status: null,
			statusFragment: null,
		});
		assert.deepStrictEqual(lines, ["verified project by human:ada at 2026-09-16T12:00:00Z"]);
	});

	const base = {
		id: "decisions/x",
		by: "human:ada",
		at: "2026-09-16T12:00:00Z",
		priorAt: [],
		dryRun: false,
		fragment: "verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n",
		statusFragment: null,
	} as const;

	it("appends the status transition to the success line (#185)", () => {
		assert.deepStrictEqual(humanVerify({ ...base, status: { from: "draft", to: "stable" } }), [
			"verified decisions/x by human:ada at 2026-09-16T12:00:00Z; status draft -> stable",
		]);
	});

	it("says `status already stable` when from equals to", () => {
		assert.deepStrictEqual(humanVerify({ ...base, status: { from: "stable", to: "stable" } }), [
			"verified decisions/x by human:ada at 2026-09-16T12:00:00Z; status already stable",
		]);
	});

	it("renders an absent prior status as (absent)", () => {
		assert.deepStrictEqual(humanVerify({ ...base, status: { from: null, to: "stable" } }), [
			"verified decisions/x by human:ada at 2026-09-16T12:00:00Z; status (absent) -> stable",
		]);
	});

	it("follows would write: with would set status: under --dry-run", () => {
		assert.deepStrictEqual(
			humanVerify({
				...base,
				dryRun: true,
				status: { from: "draft", to: "stable" },
				statusFragment: "stable",
			}),
			[
				"would verify decisions/x by human:ada at 2026-09-16T12:00:00Z; status draft -> stable (dry run, nothing written)",
				"would write:",
				"  verified:",
				"    - by: human:ada",
				"      at: 2026-09-16T12:00:00Z",
				"would set status:",
				"  stable",
			],
		);
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

	it("renders a deprecated skip (#143)", () => {
		const lines = humanVerifyBatch({
			by: "human:ada",
			at: "2026-09-16T12:00:00Z",
			dryRun: false,
			verified: [],
			skipped: [{ id: "decisions/c", reason: "deprecated" }],
		});
		assert.deepStrictEqual(lines, ["skipped decisions/c: deprecated", "verified 0, skipped 1"]);
	});
});

const plain = Render.contextOf({ audience: "agent" });
const multiLineFragment = "verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n";
const single = {
	id: "decisions/x",
	by: "human:ada",
	at: "2026-09-16T12:00:00Z",
	priorAt: ["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"],
	fragment: multiLineFragment,
	status: { from: "draft", to: "stable" },
	statusFragment: "stable\n",
} as const;

describe("humanVerifyDoc", () => {
	for (const dryRun of [false, true]) {
		it(`plain render equals the line array joined (dryRun=${dryRun}, multi-line fragment, prior entries, status)`, () => {
			const input = { ...single, dryRun };
			assert.strictEqual(Render.plain(humanVerifyDoc(input), plain), humanVerify(input).join("\n"));
		});
	}

	// Accepted difference: `Doc.verbatim` trims a whitespace-only line to empty, where the line array pads it to two
	// spaces. A hand-written `verified:` block with a blank line reaches here (splice.ts reindents it), but trailing
	// whitespace on a blank line carries nothing, so the Doc form's empty line is the cleaner preview.
	it("a fragment with a blank line renders it empty, where the line array pads it", () => {
		const input = {
			...single,
			dryRun: true,
			fragment: "verified:\n  - by: human:ada\n\n    at: 2026-09-16T12:00:00Z\n",
		};
		assert.strictEqual(
			Render.plain(humanVerifyDoc(input), plain),
			humanVerify(input)
				.map((line) => (line.trim() === "" ? "" : line))
				.join("\n"),
		);
	});

	it("a CRLF fragment and a null status render like the lines", () => {
		const input = { ...single, dryRun: true, status: null, statusFragment: null, fragment: "a:\r\n  b\r\n" };
		assert.strictEqual(Render.plain(humanVerifyDoc(input), plain), humanVerify(input).join("\n"));
	});
});

describe("humanVerifyBatchDoc", () => {
	for (const dryRun of [false, true]) {
		it(`plain render equals the line array joined (dryRun=${dryRun})`, () => {
			const input = {
				by: "human:ada",
				at: "2026-09-16T12:00:00Z",
				dryRun,
				verified: [
					{ id: "decisions/a", fragment: multiLineFragment },
					{ id: "decisions/b", fragment: "verified:\n  - by: human:ada\n" },
				],
				skipped: [
					{ id: "decisions/c", reason: "draft" },
					{ id: "decisions/d", reason: "already-verified" },
				],
			} as const;
			assert.strictEqual(Render.plain(humanVerifyBatchDoc(input), plain), humanVerifyBatch(input).join("\n"));
		});
	}
});

describe("verify docs at a finite width", () => {
	const ctx = Render.contextOf({ audience: "human", width: 20 });
	it("keeps every fact line whole", () => {
		const out = Render.ansi(
			humanVerifyBatchDoc({
				by: "human:ada",
				at: "2026-09-16T12:00:00Z",
				dryRun: false,
				verified: [{ id: "decisions/long-id", fragment: "" }],
				skipped: [{ id: "decisions/other", reason: "already-verified" }],
			}),
			ctx,
		);
		assert.strictEqual(out.split("\n").length, 3);
	});
	it("keeps the single-verify lines whole", () => {
		const out = Render.ansi(
			humanVerifyDoc({
				id: "decisions/x",
				by: "human:ada",
				at: "2026-09-16T12:00:00Z",
				priorAt: ["2026-01-01T00:00:00Z"],
				dryRun: false,
				fragment: "",
				status: null,
				statusFragment: null,
			}),
			ctx,
		);
		assert.strictEqual(out.split("\n").length, 2);
	});
});
