import { assert, describe, it } from "@effect/vitest";
import * as Engine from "../src/index.js";

describe("@okfit/engine", () => {
	it("exposes a barrel that can be imported", () => {
		// An ES module namespace object's toString tag is "[object Module]",
		// both empty (this barrel today) and once Task 2 adds exports -- so
		// this pins the barrel actually being an ES module namespace object
		// without breaking as soon as real exports land.
		assert.strictEqual(Object.prototype.toString.call(Engine), "[object Module]");
	});
});
