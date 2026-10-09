import { assert, describe, it } from "@effect/vitest";
import { Render } from "@effected/cli";
import { Option } from "effect";
import { humanStale, humanStaleDoc } from "../../src/render/stale.js";

const items = [
	{ id: "decisions/a", stale_after: "2026-01-01T00:00:00Z", days_past: 12 },
	{ id: "project", stale_after: "2026-02-01T00:00:00Z", days_past: 1 },
];

describe("humanStaleDoc", () => {
	it("plain render equals the line array joined", () => {
		assert.strictEqual(
			Render.plain(humanStaleDoc(items), Render.contextOf({ audience: "agent" })),
			humanStale(items).join("\n"),
		);
	});

	it("renders nothing for no stale concepts", () => {
		assert.strictEqual(Render.plain(humanStaleDoc([]), Render.contextOf({ audience: "agent" })), "");
	});

	it("links each id to its concept file when a root is given, and only the id", () => {
		const out = Render.ansi(
			humanStaleDoc(items, { root: "/repo/okf" }),
			Render.contextOf({
				audience: "human",
				color: "basic",
				links: { mode: "file", target: (t) => Option.some("file" in t ? `file://${t.file}` : t.url) },
			}),
		);
		assert.include(out, "file:///repo/okf/decisions/a.md");
		assert.include(out, "file:///repo/okf/project.md");
	});
});

describe("humanStaleDoc at a finite width", () => {
	it("keeps each stale item on one physical line", () => {
		const out = Render.ansi(humanStaleDoc(items), Render.contextOf({ audience: "human", width: 20 }));
		assert.strictEqual(out.split("\n").length, items.length);
	});
});
