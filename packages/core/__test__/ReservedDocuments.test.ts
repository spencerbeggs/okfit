import { assert, describe, it } from "@effect/vitest";
import { DiagnosticRange } from "../src/Diagnostic.js";
import { IndexDocument, IndexEntry, IndexSection } from "../src/IndexDocument.js";
import { LogDocument, LogGroup, LogItem } from "../src/LogDocument.js";

const zeroRange = new DiagnosticRange({ offset: 0, length: 0, line: 0, character: 0 });

describe("IndexDocument", () => {
	it("holds sections of entries and an optional root okfVersion", () => {
		const entry = IndexEntry.make({ title: "Orders", target: "orders.md", range: zeroRange });
		const section = IndexSection.make({ heading: "Tables", entries: [entry], range: zeroRange });
		const doc = IndexDocument.make({ path: "tables/index.md", dir: "tables", sections: [section] });
		assert.isFalse("okfVersion" in doc);
		const root = IndexDocument.make({ path: "index.md", dir: "", okfVersion: "0.2", sections: [] });
		assert.strictEqual(root.okfVersion, "0.2");
	});
});

describe("LogDocument", () => {
	it("holds date groups of items", () => {
		const item = LogItem.make({ text: "Added orders table", range: zeroRange });
		const group = LogGroup.make({ date: "2026-06-30", items: [item], range: zeroRange });
		const doc = LogDocument.make({ path: "log.md", dir: "", groups: [group] });
		assert.strictEqual(doc.groups[0]!.date, "2026-06-30");
		assert.isFalse("title" in doc);
	});
});
