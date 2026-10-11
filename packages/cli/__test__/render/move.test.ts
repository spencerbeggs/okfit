import { assert, describe, it } from "@effect/vitest";
import { Render } from "@effected/cli";
import { humanMoveDoc } from "../../src/render/move.js";

const agent = Render.contextOf({ audience: "agent" });

const plan = {
	from: "decisions/b",
	to: "decisions/beta",
	edits: [
		{ path: "decisions/a.md", count: 1 },
		{ path: "decisions/beta.md", count: 0 },
	],
	drifts: ["decisions/a"],
};

describe("humanMoveDoc", () => {
	it("renders a real move", () => {
		assert.strictEqual(
			Render.plain(humanMoveDoc({ ...plan, dryRun: false }), agent),
			[
				"moved decisions/b -> decisions/beta",
				"  rewrote decisions/a.md (1 reference)",
				"  rewrote decisions/beta.md (0 references)",
				"will drift (a human re-verifies): decisions/a",
				"next: okfit sync",
			].join("\n"),
		);
	});

	it("renders a dry run", () => {
		assert.strictEqual(
			Render.plain(humanMoveDoc({ ...plan, dryRun: true }), agent),
			[
				"would move decisions/b -> decisions/beta; nothing written",
				"  would rewrite decisions/a.md (1 reference)",
				"  would rewrite decisions/beta.md (0 references)",
				"will drift (a human re-verifies): decisions/a",
				"next: okfit sync",
			].join("\n"),
		);
	});
});
