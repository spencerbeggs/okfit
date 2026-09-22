import { assert, describe, it } from "@effect/vitest";
import { DiagnosticRange } from "@okfit/core";
import type { RenderedDiagnostic } from "../../src/render/sort.js";
import { diffDiagnostics, groupByFile } from "../../src/session/diff.js";

const d = (file: string, message: string, offset?: number): RenderedDiagnostic => ({
	source: "core.lint",
	file,
	code: "broken-links",
	severity: "warning",
	message,
	...(offset === undefined ? {} : { range: DiagnosticRange.make({ offset, length: 1, line: 0, character: offset }) }),
});

describe("groupByFile", () => {
	it("groups in input order and never stores an empty list", () => {
		const grouped = groupByFile([d("a.md", "1"), d("b.md", "2"), d("a.md", "3")]);
		assert.deepStrictEqual([...grouped.keys()], ["a.md", "b.md"]);
		assert.deepStrictEqual(
			grouped.get("a.md")?.map((x) => x.message),
			["1", "3"],
		);
	});
});

describe("diffDiagnostics", () => {
	it("identical sets yield an empty map, and one changed message yields exactly that file", () => {
		const previous = groupByFile([d("a.md", "x", 5), d("b.md", "y", 7)]);
		assert.strictEqual(diffDiagnostics(previous, groupByFile([d("a.md", "x", 5), d("b.md", "y", 7)])).size, 0);
		const changed = diffDiagnostics(previous, groupByFile([d("a.md", "x", 5), d("b.md", "y2", 7)]));
		assert.deepStrictEqual([...changed.keys()], ["b.md"]);
	});

	it("a file whose set became empty maps to []", () => {
		const changed = diffDiagnostics(groupByFile([d("a.md", "x")]), groupByFile([]));
		assert.deepStrictEqual([...changed.entries()], [["a.md", []]]);
	});

	it("a shifted range is a change; a new file is a change", () => {
		const previous = groupByFile([d("a.md", "x", 5)]);
		const changed = diffDiagnostics(previous, groupByFile([d("a.md", "x", 6), d("c.md", "z")]));
		assert.deepStrictEqual([...changed.keys()].toSorted(), ["a.md", "c.md"]);
	});

	it("the same offset and length on a different line is a change", () => {
		const moved: RenderedDiagnostic = {
			...d("a.md", "x"),
			range: DiagnosticRange.make({ offset: 5, length: 1, line: 1, character: 0 }),
		};
		const changed = diffDiagnostics(groupByFile([d("a.md", "x", 5)]), groupByFile([moved]));
		assert.deepStrictEqual([...changed.keys()], ["a.md"]);
	});
});
