import { assert, describe, it } from "@effect/vitest";
import { DiagnosticRange } from "@okfit/core";
import type { RenderedDiagnostic } from "@okfit/engine";
import { SEVERITY, toLspDiagnostic } from "../../src/convert/diagnostic.js";

const text = "---\ntype: Module\n---\n\n# A\n\nSee [B](b.md).\n";
const base: RenderedDiagnostic = {
	source: "core.lint",
	file: "a.md",
	code: "broken-links",
	severity: "warning",
	message: "b.md does not exist",
};

describe("toLspDiagnostic", () => {
	it("maps a ranged diagnostic to start/end positions computed from the text", () => {
		const offset = text.indexOf("b.md");
		const range = DiagnosticRange.fromOffset(text, offset, 4);
		const lsp = toLspDiagnostic({ ...base, range }, text);
		assert.deepStrictEqual(lsp.range, { start: { line: 6, character: 8 }, end: { line: 6, character: 12 } });
		assert.strictEqual(lsp.severity, SEVERITY.warning);
		assert.strictEqual(lsp.code, "broken-links");
		assert.strictEqual(lsp.source, "okfit");
		assert.deepStrictEqual(lsp.data, { source: "core.lint" });
		assert.strictEqual(lsp.message, "b.md does not exist");
	});
	it("a range spanning a newline ends on the later line", () => {
		const offset = text.indexOf("# A");
		const lsp = toLspDiagnostic({ ...base, range: DiagnosticRange.fromOffset(text, offset, 5) }, text);
		assert.deepStrictEqual(lsp.range.end, { line: 6, character: 0 });
		const stopsBeforeNewline = toLspDiagnostic({ ...base, range: DiagnosticRange.fromOffset(text, offset, 3) }, text);
		assert.deepStrictEqual(stopsBeforeNewline.range.end, { line: 4, character: 3 });
	});
	it("without text, end is start plus length on the same line", () => {
		const lsp = toLspDiagnostic(
			{ ...base, range: DiagnosticRange.make({ offset: 30, length: 4, line: 6, character: 8 }) },
			undefined,
		);
		assert.deepStrictEqual(lsp.range, { start: { line: 6, character: 8 }, end: { line: 6, character: 12 } });
	});
	it("a range-less diagnostic gets the zero range", () => {
		const lsp = toLspDiagnostic(base, text);
		assert.deepStrictEqual(lsp.range, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
	});
	it("maps every severity", () => {
		assert.strictEqual(toLspDiagnostic({ ...base, severity: "error" }, text).severity, 1);
		assert.strictEqual(toLspDiagnostic({ ...base, severity: "info" }, text).severity, 3);
	});
});
