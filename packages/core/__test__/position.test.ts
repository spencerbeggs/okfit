import { assert, describe, it } from "@effect/vitest";
import { FRONTMATTER_FENCE, frontmatterValueStart, lineCharacter, toFileOffset } from "../src/internal/position.js";

const LF = "---\ntype: Note\ntitle: Widget\n---\n\n# Widget\n";
const CRLF = "---\r\ntype: Note\r\ntitle: Widget\r\n---\r\n";
const CR = "---\rtype: Note\r---\r";

describe("internal/position", () => {
	it("lineCharacter is zero-based and counts LF, CR and CRLF once each", () => {
		assert.deepStrictEqual(lineCharacter(LF, 0), { line: 0, character: 0 });
		assert.deepStrictEqual(lineCharacter(LF, 4), { line: 1, character: 0 });
		assert.deepStrictEqual(lineCharacter(LF, 10), { line: 1, character: 6 });
		assert.deepStrictEqual(lineCharacter(LF, LF.indexOf("# Widget")), { line: 5, character: 0 });
		assert.deepStrictEqual(lineCharacter(CRLF, 5), { line: 1, character: 0 });
		assert.deepStrictEqual(lineCharacter(CRLF, CRLF.indexOf("title")), { line: 2, character: 0 });
		assert.deepStrictEqual(lineCharacter(CR, 4), { line: 1, character: 0 });
	});

	it("frontmatterValueStart is fence length plus terminator length", () => {
		assert.strictEqual(FRONTMATTER_FENCE.length, 3);
		assert.strictEqual(frontmatterValueStart(LF), 4);
		assert.strictEqual(frontmatterValueStart(CRLF), 5);
		assert.strictEqual(frontmatterValueStart(CR), 4);
	});

	it("toFileOffset lands a yaml offset on the same text in the file", () => {
		const yaml = "type: Note\ntitle: Widget";
		const fileOffset = toFileOffset(LF, yaml.indexOf("Widget"));
		assert.strictEqual(LF.slice(fileOffset, fileOffset + 6), "Widget");
		assert.deepStrictEqual(lineCharacter(LF, fileOffset), { line: 2, character: 7 });
		const crlfYaml = "type: Note\r\ntitle: Widget";
		const crlfOffset = toFileOffset(CRLF, crlfYaml.indexOf("Widget"));
		assert.strictEqual(CRLF.slice(crlfOffset, crlfOffset + 6), "Widget");
	});
});
