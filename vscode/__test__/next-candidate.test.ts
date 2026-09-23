import { describe, expect, it } from "vitest";
import { nextCandidate } from "../src/next-candidate.js";

describe("nextCandidate", () => {
	it("tries the next candidate for a workspace source without the capability", () => {
		expect(nextCandidate("workspace", false)).toBe("try-next");
	});

	it("keeps a setting source even without the capability", () => {
		expect(nextCandidate("setting", false)).toBe("keep");
	});

	it("keeps a bundled source even without the capability", () => {
		expect(nextCandidate("bundled", false)).toBe("keep");
	});

	it("keeps a bundled-path-node source even without the capability", () => {
		expect(nextCandidate("bundled-path-node", false)).toBe("keep");
	});

	it("keeps any source that has the capability", () => {
		expect(nextCandidate("workspace", true)).toBe("keep");
		expect(nextCandidate("setting", true)).toBe("keep");
		expect(nextCandidate("bundled", true)).toBe("keep");
		expect(nextCandidate("bundled-path-node", true)).toBe("keep");
	});
});
