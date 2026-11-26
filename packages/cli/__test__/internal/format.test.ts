import { assert, describe, it } from "@effect/vitest";
import { Format } from "../../src/internal/format.js";
import { defaultOf, nameOf } from "../utils/params.js";

describe("Format", () => {
	it('is the --format flag, defaulting to "human" (auto), shared by the eight commands that take it', () => {
		assert.strictEqual(nameOf(Format.flag), "format");
		assert.strictEqual(defaultOf(Format.flag), "auto");
	});
});
