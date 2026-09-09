import { assert, describe, it } from "@effect/vitest";
import type { SyncResult } from "@okfit/engine";
import { humanSync } from "../../src/render/sync.js";

const EMPTY_MODE = { selected: true, written: [], unchanged: [], skipped: [] } as const;

const baseResult: SyncResult = {
	bundleRoot: "/repo/okf",
	dryRun: false,
	generated: { ...EMPTY_MODE, written: ["decisions/x"] },
	index: { ...EMPTY_MODE, unchanged: ["modules/index.md"] },
	log: { ...EMPTY_MODE, written: ["log.md"] },
};

describe("humanSync", () => {
	it("renders one reason sentence per SkipReason member (contract §9.2's table)", () => {
		const result: SyncResult = {
			bundleRoot: "/repo/okf",
			dryRun: false,
			generated: {
				selected: true,
				written: [],
				unchanged: [],
				skipped: [
					{ id: "a", reason: "untracked" },
					{ id: "b", reason: "dirty" },
					{ id: "c", reason: "unborn" },
					{ id: "d", reason: "generated-missing" },
					{ id: "e", reason: "generated-unsupported" },
				],
			},
			index: EMPTY_MODE,
			log: { ...EMPTY_MODE, skipped: [{ id: "log.md", reason: "log-unparseable" }] },
		};
		const lines = humanSync(result).join("\n");
		assert.isTrue(lines.includes("not tracked by git"));
		assert.isTrue(lines.includes("has uncommitted changes"));
		assert.isTrue(lines.includes("the repository has no commits yet"));
		assert.isTrue(lines.includes("has no generated block"));
		assert.isTrue(lines.includes("generated.at is a shape sync cannot edit; edit it by hand"));
		assert.isTrue(lines.includes("log.md could not be parsed; see okfit validate"));
	});

	it("lists written and unchanged ids per mode", () => {
		const lines = humanSync(baseResult).join("\n");
		assert.isTrue(lines.includes("decisions/x"));
		assert.isTrue(lines.includes("modules/index.md"));
		assert.isTrue(lines.includes("log.md"));
	});
});
