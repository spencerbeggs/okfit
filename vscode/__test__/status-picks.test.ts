import { describe, expect, it } from "vitest";
import { conceptUriFrom, statusPicks } from "../src/status-picks.js";
import { writtenStatus } from "../src/tree/model.js";

describe("statusPicks", () => {
	it("offers draft and deprecated for a stable concept", () => {
		expect(statusPicks("stable").map((p) => p.label)).toEqual(["draft", "deprecated"]);
	});

	it("offers all three when the concept has no explicit status, so stable can be made explicit", () => {
		expect(statusPicks(undefined).map((p) => p.label)).toEqual(["draft", "stable", "deprecated"]);
	});

	it("offers stable and deprecated for a draft concept", () => {
		expect(statusPicks("draft").map((p) => p.label)).toEqual(["stable", "deprecated"]);
	});

	it("offers stable and draft for a deprecated concept", () => {
		expect(statusPicks("deprecated").map((p) => p.label)).toEqual(["draft", "stable"]);
	});

	it("gives every pick a non-empty description", () => {
		for (const pick of statusPicks("stable")) {
			expect(pick.description.length).toBeGreaterThan(0);
		}
	});
});

describe("conceptUriFrom", () => {
	it("prefers a tree node argument's uri", () => {
		expect(conceptUriFrom({ kind: "concept", uri: "file:///a.md" }, "file:///active.md")).toBe("file:///a.md");
	});

	it("falls back to the active editor uri when the argument is not a tree node", () => {
		expect(conceptUriFrom(undefined, "file:///active.md")).toBe("file:///active.md");
	});

	it("is undefined with neither a tree node argument nor an active editor", () => {
		expect(conceptUriFrom(undefined, undefined)).toBeUndefined();
	});
});

describe("the Set status picks for a concept off the wire", () => {
	const labelsFor = (c: Parameters<typeof writtenStatus>[0]) => statusPicks(writtenStatus(c)).map((p) => p.label);

	it("offers all three on a concept with no status line, though the server derives stable", () => {
		expect(labelsFor({ status: "stable", explicitStatus: false })).toEqual(["draft", "stable", "deprecated"]);
	});

	it("offers the other two on a concept that writes stable (control)", () => {
		expect(labelsFor({ status: "stable", explicitStatus: true })).toEqual(["draft", "deprecated"]);
	});

	it("offers all three on an unknown status, which is not written as a known one", () => {
		expect(labelsFor({ status: "unknown", rawStatus: "archived", explicitStatus: true })).toEqual([
			"draft",
			"stable",
			"deprecated",
		]);
	});

	it("reads a server that predates explicitStatus: no status sent means none written", () => {
		expect(labelsFor({})).toEqual(["draft", "stable", "deprecated"]);
		expect(labelsFor({ status: "stable" })).toEqual(["draft", "deprecated"]);
	});
});
