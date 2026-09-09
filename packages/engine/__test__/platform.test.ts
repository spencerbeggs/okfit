import { assert, describe, it } from "@effect/vitest";
import { Layer } from "effect";
import { OKFIT_APP_NAMESPACE, OkfitPlatform } from "../src/platform.js";

describe("OkfitPlatform", () => {
	it("names the app directory namespace once, as a shared constant", () => {
		assert.strictEqual(OKFIT_APP_NAMESPACE, "okfit");
	});

	it("is a Layer, so both front ends provide the same services", () => {
		assert.isTrue(Layer.isLayer(OkfitPlatform));
	});
});
