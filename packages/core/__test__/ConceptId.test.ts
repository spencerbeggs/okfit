import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { ConceptId } from "../src/ConceptId.js";

describe("ConceptId", () => {
	it("fromPath strips .md, rejects reserved basenames and non-md paths", () => {
		assert.deepStrictEqual(ConceptId.fromPath("tables/orders.md"), Option.some("tables/orders"));
		assert.deepStrictEqual(ConceptId.fromPath("index.md"), Option.none());
		assert.deepStrictEqual(ConceptId.fromPath("tables/index.md"), Option.none());
		assert.deepStrictEqual(ConceptId.fromPath("tables/log.md"), Option.none());
		assert.deepStrictEqual(ConceptId.fromPath("tables/orders.py"), Option.none());
	});
	it("toPath appends .md", () => {
		assert.strictEqual(
			ConceptId.toPath(ConceptId.fromPath("tables/orders.md").pipe(Option.getOrThrow)),
			"tables/orders.md",
		);
	});
	it("normalize strips a leading slash and a trailing .md, collapses //, and rejects empty input", () => {
		assert.deepStrictEqual(ConceptId.normalize("/tables/orders.md"), Option.some("tables/orders"));
		assert.deepStrictEqual(ConceptId.normalize("tables//orders"), Option.some("tables/orders"));
		assert.deepStrictEqual(ConceptId.normalize("/"), Option.none());
		assert.deepStrictEqual(ConceptId.normalize(""), Option.none());
	});
	it("isReservedFile matches index.md and log.md at any depth", () => {
		assert.isTrue(ConceptId.isReservedFile("index.md"));
		assert.isTrue(ConceptId.isReservedFile("tables/log.md"));
		assert.isFalse(ConceptId.isReservedFile("tables/orders.md"));
	});
});
