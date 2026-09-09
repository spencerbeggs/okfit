import { assert, describe, it } from "@effect/vitest";
import * as Engine from "../src/index.js";

describe("@okfit/engine", () => {
	it("exposes a barrel that can be imported", () => {
		assert.exists(Engine);
	});
});
