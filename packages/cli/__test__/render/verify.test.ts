import { assert, describe, it } from "@effect/vitest";
import { Render } from "@effected/cli-kit";
import {
	humanRevoke,
	humanRevokeDoc,
	humanVerify,
	humanVerifyBatch,
	humanVerifyBatchDoc,
	humanVerifyDoc,
	notCurrentReason,
} from "../../src/render/verify.js";

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

	it("announces a re-verify of drifted content instead of the append line", () => {
		assert.deepStrictEqual(
			humanVerify({ ...base, status: null, priorAt: ["2026-09-01T00:00:00Z"], priorDrift: "content-changed" }),
			["re-verifying (was drifted: content-changed)", "verified decisions/x by human:ada at 2026-09-16T12:00:00Z"],
		);
		assert.deepStrictEqual(
			humanVerify({ ...base, status: null, priorAt: ["2026-09-01T00:00:00Z"], priorDrift: null }),
			[
				"already verified by human:ada at 2026-09-01T00:00:00Z; appending",
				"verified decisions/x by human:ada at 2026-09-16T12:00:00Z",
			],
		);
		assert.strictEqual(
			Render.plain(
				humanVerifyDoc({ ...base, status: null, priorAt: ["2026-09-01T00:00:00Z"], priorDrift: "unbound" }),
				Render.contextOf({ audience: "agent" }),
			),
			"re-verifying (was drifted: unbound)\nverified decisions/x by human:ada at 2026-09-16T12:00:00Z",
		);
	});

	it("keeps the first-time wording when the actor had no prior entry, even over another actor's drift", () => {
		assert.deepStrictEqual(humanVerify({ ...base, status: null, priorAt: [], priorDrift: "unbound" }), [
			"verified decisions/x by human:ada at 2026-09-16T12:00:00Z",
		]);
	});

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
			"skipped decisions/d: status draft, so a batch leaves it out; verify it on its own with okfit verify decisions/d --stable to settle it, or --draft to keep it a draft",
			"would verify decisions/a by human:ada at 2026-09-16T12:00:00Z",
			"would write:",
			"  verified:",
			"    - by: human:ada",
			"      at: 2026-09-16T12:00:00Z",
			"would verify 1, skipped 1 (dry run, nothing written)",
		]);
	});

	it("renders an unknown-status skip with the step that works (#507)", () => {
		const lines = humanVerifyBatch({
			by: "human:ada",
			at: "2026-09-16T12:00:00Z",
			dryRun: false,
			verified: [],
			skipped: [{ id: "decisions/wip", reason: "unknown-status", status: "wip" }],
		});
		assert.deepStrictEqual(lines, [
			'skipped decisions/wip: status "wip" is not draft, stable or deprecated, so it cannot be verified; set its status in the frontmatter, or verify it on its own with okfit verify decisions/wip --stable or --draft',
			"verified 0, skipped 1",
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
			"skipped decisions/b: already verified by human:ada, and that verification still covers its content; nothing to do",
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
		assert.deepStrictEqual(lines, [
			"skipped decisions/c: status deprecated, so a batch leaves it out, and a batch has nothing to verify while it is retired; if it is current again, set its status, or verify it with okfit verify decisions/c --stable",
			"verified 0, skipped 1",
		]);
	});

	it("each skip reason names a next step (#517)", () => {
		const lines = humanVerifyBatch({
			by: "human:ada",
			at: "2026-09-16T12:00:00Z",
			dryRun: false,
			verified: [],
			skipped: [
				{ id: "decisions/d", reason: "draft" },
				{ id: "decisions/c", reason: "deprecated" },
				{ id: "decisions/b", reason: "already-verified" },
				{ id: "decisions/wip", reason: "unknown-status", status: "wip" },
				{
					id: "decisions/f",
					reason: "not-current",
					notCurrent: { kind: "future", generatedAt: "2027-01-01T00:00:00Z", at: "2026-09-16T12:00:00Z" },
				},
				{
					id: "decisions/n",
					reason: "not-current",
					notCurrent: { kind: "near-future", generatedAt: "2026-09-16T12:02:00Z", at: "2026-09-16T12:00:00Z" },
				},
				{
					id: "decisions/k",
					reason: "not-current",
					notCurrent: {
						kind: "blocked",
						generatedAt: "2027-01-01T00:00:00Z",
						at: "2026-09-16T12:00:00Z",
						blockedBy: "2026-12-25T00:00:00Z",
					},
				},
				{
					id: "decisions/a",
					reason: "not-current",
					notCurrent: { generatedAt: "2026-09-16T11:59:30Z", at: "2026-09-16T11:59:00Z" },
				},
				{ id: "decisions/u", reason: "unknown-status" },
				{ id: "decisions/x", reason: "not-current" },
			],
		});
		const steps = [
			"okfit verify",
			"okfit sync",
			"check the clock",
			"a human must",
			"omit --at",
			"set its status",
			"nothing to do",
		];
		const skips = lines.filter((line) => line.startsWith("skipped "));
		assert.strictEqual(skips.length, 10);
		const fallbacks = ["skipped decisions/u: unknown-status", "skipped decisions/x: not-current"];
		assert.deepStrictEqual(skips.slice(-2), fallbacks);
		for (const line of skips.slice(0, -2)) {
			assert.isTrue(
				steps.some((step) => line.includes(step)),
				`no next step in: ${line}`,
			);
		}
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

describe("humanRevoke", () => {
	const base = { id: "decisions/x", by: "human:ada", removed: ["2026-09-01T00:00:00Z"], bindingCleared: true };

	it("reports what was removed and the cleared binding", () => {
		assert.deepStrictEqual(humanRevoke({ ...base, dryRun: false }), [
			"revoked 1 verified entry of decisions/x by human:ada",
			"  removed entry at 2026-09-01T00:00:00Z",
			"  cleared the x-okfit-integrity.verified binding",
		]);
	});

	it("phrases a dry run as what would happen and omits the binding line when it stays", () => {
		assert.deepStrictEqual(humanRevoke({ ...base, removed: ["a", "b"], bindingCleared: false, dryRun: true }), [
			"would revoke 2 verified entries of decisions/x by human:ada (dry run, nothing written)",
			"  would remove entry at a",
			"  would remove entry at b",
		]);
	});

	it("the Doc form prints the same plain lines", () => {
		const out = Render.plain(
			humanRevokeDoc({ ...base, dryRun: false }),
			Render.contextOf({ audience: "human", width: 80 }),
		);
		assert.strictEqual(out, humanRevoke({ ...base, dryRun: false }).join("\n"));
	});
});

describe("notCurrentReason (#504)", () => {
	const at = "2026-11-25T12:00:00Z";
	const g = "2027-11-25T12:00:00Z";
	it("names the step for each kind", () => {
		assert.strictEqual(
			notCurrentReason({ at, generatedAt: g, kind: "future" }),
			`generated.at ${g} is later than now, so no verification made now would count; run okfit sync, which re-stamps it, then verify it again`,
		);
		assert.strictEqual(
			notCurrentReason({ at, generatedAt: g, kind: "near-future" }),
			`generated.at ${g} is later than now by less than 5 minutes, so no verification made now would count yet; check the clock, or verify it again at or after ${g}`,
		);
		assert.strictEqual(
			notCurrentReason({ at, generatedAt: g, kind: "blocked", blockedBy: "2026-12-25T00:00:00Z" }),
			`generated.at ${g} is later than now, and okfit sync will not re-stamp it, because the verification dated 2026-12-25T00:00:00Z would then count without a re-verification; a human must correct generated.at or that verification`,
		);
		assert.strictEqual(
			notCurrentReason({ at, generatedAt: g }),
			`generated.at ${g} is later than the verification time ${at}, so a verification then would not count; verify it at or after ${g}, or omit --at to verify now`,
		);
	});

	it("humanVerifyBatch prints the reason of each not-current skip", () => {
		const lines = humanVerifyBatch({
			by: "human:ada",
			at,
			dryRun: false,
			verified: [],
			skipped: [{ id: "decisions/x", reason: "not-current", notCurrent: { at, generatedAt: g, kind: "future" } }],
		});
		assert.deepStrictEqual(lines, [
			`skipped decisions/x: generated.at ${g} is later than now, so no verification made now would count; run okfit sync, which re-stamps it, then verify it again`,
			"verified 0, skipped 1",
		]);
	});
});
