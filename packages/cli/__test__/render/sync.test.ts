import { assert, describe, it } from "@effect/vitest";
import type { SyncResult } from "@okfit/engine";
import { humanSync } from "../../src/render/sync.js";

const EMPTY_MODE = { selected: true, written: [], unchanged: [], migrated: [], skipped: [] } as const;

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
				migrated: [],
				skipped: [
					{ id: "a", reason: "untracked" },
					{ id: "b", reason: "dirty" },
					{ id: "c", reason: "unborn" },
					{ id: "d", reason: "generated-missing" },
					{ id: "e", reason: "generated-unsupported" },
					{ id: "f", reason: "integrity-unsupported" },
				],
			},
			index: EMPTY_MODE,
			log: { ...EMPTY_MODE, skipped: [{ id: "log.md", reason: "log-unparseable" }] },
		};
		const lines = humanSync(result).join("\n");
		assert.isTrue(
			lines.includes("skipped a: not tracked by git; add the file to git and commit it, then run okfit sync again"),
		);
		assert.isTrue(lines.includes("skipped b: has uncommitted changes; commit the change, then run okfit sync again"));
		assert.isTrue(lines.includes("the repository has no commits yet"));
		assert.isTrue(lines.includes("has no generated block"));
		assert.isTrue(lines.includes("generated.at is a shape sync cannot edit; edit it by hand"));
		assert.isTrue(lines.includes("integrity is a shape sync cannot edit; edit it by hand"));
		assert.isTrue(lines.includes("log.md could not be parsed; see okfit validate"));
	});

	it("renders the index-unparseable sentence (#512)", () => {
		const lines = humanSync({
			...baseResult,
			index: { ...EMPTY_MODE, skipped: [{ id: "index.md", reason: "index-unparseable" }] },
		});
		assert.include(
			lines,
			"  skipped index.md: could not be read (its frontmatter does not close or does not parse); fix it by hand (see okfit validate), then run okfit sync again",
		);
	});

	it("names the two instants of a skipped repair that would revive a verification (#471)", () => {
		const lines = humanSync({
			...baseResult,
			generated: {
				...EMPTY_MODE,
				skipped: [
					{
						id: "a",
						reason: "verified-after-now",
						generatedAt: "2030-06-01T00:00:00Z",
						verifiedAt: "2029-01-01T00:00:00Z",
					},
				],
			},
		});
		assert.include(
			lines,
			"  skipped a: generated.at 2030-06-01T00:00:00Z is later than now, but re-stamping it would make the verification dated 2029-01-01T00:00:00Z count without a re-verification; a human must correct generated.at or that verification",
		);
	});

	it("summarizes a separate migrated total", () => {
		const lines = humanSync({ ...baseResult, generated: { ...EMPTY_MODE, migrated: ["a", "b"] } });
		assert.isTrue(lines.some((l) => l.startsWith("wrote 1, migrated 2, unchanged")));
	});

	it("says a skipped concept's old keys were still renamed when it is also migrated", () => {
		const lines = humanSync({
			...baseResult,
			generated: {
				...EMPTY_MODE,
				migrated: ["a"],
				skipped: [
					{ id: "a", reason: "dirty" },
					{ id: "b", reason: "dirty" },
				],
			},
		});
		assert.include(
			lines,
			"  skipped a: has uncommitted changes; commit the change, then run okfit sync again (its old okfit keys are still renamed)",
		);
		assert.include(lines, "  skipped b: has uncommitted changes; commit the change, then run okfit sync again");
		assert.isTrue(lines.some((l) => l.includes("migrated 1,") && l.includes("skipped 2")));
	});

	it("says would-be-renamed on a dry run", () => {
		const lines = humanSync({
			...baseResult,
			dryRun: true,
			generated: { ...EMPTY_MODE, migrated: ["a"], skipped: [{ id: "a", reason: "dirty" }] },
		});
		assert.include(
			lines,
			"  skipped a: has uncommitted changes; commit the change, then run okfit sync again (its old okfit keys would still be renamed)",
		);
	});

	it("names what legacy-key-unsupported refuses, and not a top-level merge key", () => {
		const lines = humanSync({
			...baseResult,
			generated: { ...EMPTY_MODE, skipped: [{ id: "a", reason: "legacy-key-unsupported" }] },
		}).join("\n");
		assert.include(lines, "an alias or a `<<` merge in the old block");
		assert.notInclude(lines, "merge key");
	});

	it("lists migrated ids", () => {
		const lines = humanSync({ ...baseResult, generated: { ...EMPTY_MODE, migrated: ["decisions/old"] } }).join("\n");
		assert.isTrue(lines.includes("migrated decisions/old"));
	});

	it("lists written and unchanged ids per mode", () => {
		const lines = humanSync(baseResult).join("\n");
		assert.isTrue(lines.includes("decisions/x"));
		assert.isTrue(lines.includes("modules/index.md"));
		assert.isTrue(lines.includes("log.md"));
	});
});
