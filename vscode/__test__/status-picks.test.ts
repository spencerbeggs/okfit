import { describe, expect, it } from "vitest";
import { conceptUriFrom, statusPicks } from "../src/status-picks.js";

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
