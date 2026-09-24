import { describe, expect, it } from "vitest";
import { buildTree, decorationFor, iconFor, shouldApplyRefresh, staleCount } from "../src/tree/model.js";
import type { ConceptsResult } from "../src/tree/wire.js";

const c = (over: Partial<ConceptsResult["bundles"][number]["concepts"][number]>) => ({
	id: "modules/a",
	uri: "file:///w/okf/modules/a.md",
	title: "A",
	type: "Module",
	status: undefined,
	stale: false,
	...over,
});

const one: ConceptsResult = {
	bundles: [
		{
			root: "/w/okf",
			rootUri: "file:///w/okf",
			profile: "software-project",
			concepts: [
				c({ id: "decisions/x", title: "X", type: "Decision", status: "stable" }),
				c({ id: "modules/a", title: "A", stale: true }),
				c({ id: "modules/b", title: "B", status: "draft" }),
			],
		},
	],
};

describe("buildTree", () => {
	it("with one bundle, groups by type at the top level with counts", () => {
		const tree = buildTree(one);
		expect(tree.map((n) => n.kind)).toEqual(["type", "type"]);
		expect(tree.map((n) => (n.kind === "type" ? [n.label, n.count] : null))).toEqual([
			["Decision", 1],
			["Module", 2],
		]);
	});

	it("an absent status renders as stable, the OKF default", () => {
		const modules = buildTree(one)[1]!;
		const a = modules.kind === "type" ? modules.children[0]! : null;
		expect(a?.kind === "concept" && a.status).toBe("stable");
		expect(a?.kind === "concept" && a.description).toBe("stable");
	});

	it("with two bundles, nests type groups under a bundle node labelled by root basename", () => {
		const two: ConceptsResult = {
			bundles: [one.bundles[0]!, { ...one.bundles[0]!, root: "/v/okf", rootUri: "file:///v/okf" }],
		};
		const tree = buildTree(two);
		expect(tree.map((n) => n.kind)).toEqual(["bundle", "bundle"]);
		expect(tree[0]!.kind === "bundle" && tree[0]!.label).toBe("okf");
		expect(tree[0]!.kind === "bundle" && tree[0]!.description).toBe("/w/okf");
	});

	it("returns an empty tree for no bundles", () => {
		expect(buildTree({ bundles: [] })).toEqual([]);
	});
});

describe("staleCount", () => {
	it("counts stale concepts across bundles", () => {
		expect(staleCount(one)).toBe(1);
		expect(staleCount({ bundles: [one.bundles[0]!, one.bundles[0]!] })).toBe(2);
		expect(staleCount({ bundles: [] })).toBe(0);
	});
});

describe("iconFor", () => {
	it("maps known types to codicons and unknown ones to a default", () => {
		expect(iconFor("Decision")).toBe("law");
		expect(iconFor("Module")).toBe("package");
		expect(iconFor("Nonsense")).toBe("symbol-misc");
	});
});

describe("decorationFor", () => {
	it("badges stale and draft, nothing for a fresh stable concept", () => {
		const node = buildTree(one)[1]!;
		const [a, b] = node.kind === "type" ? node.children : [];
		expect(a?.kind === "concept" && decorationFor(a)).toEqual({ badge: "S", tooltip: "Stale" });
		expect(b?.kind === "concept" && decorationFor(b)).toEqual({ badge: "D", tooltip: "Draft" });
		const x = buildTree(one)[0]!;
		const dec = x.kind === "type" && x.children[0]?.kind === "concept" ? decorationFor(x.children[0]) : "unset";
		expect(dec).toBeUndefined();
	});

	it("badges a deprecated concept", () => {
		const deprecated: ConceptsResult = {
			bundles: [{ ...one.bundles[0]!, concepts: [c({ id: "modules/c", title: "C", status: "deprecated" })] }],
		};
		const node = buildTree(deprecated)[0]!;
		const concept = node.kind === "type" ? node.children[0] : undefined;
		expect(concept?.kind === "concept" && decorationFor(concept)).toEqual({ badge: "X", tooltip: "Deprecated" });
	});
});

describe("shouldApplyRefresh", () => {
	it("applies a result whose generation is still current and the provider is not disposed", () => {
		expect(shouldApplyRefresh(1, 1, false)).toBe(true);
	});

	it("drops a stale result superseded by a later refresh", () => {
		expect(shouldApplyRefresh(1, 2, false)).toBe(false);
	});

	it("drops any result once the provider is disposed, even at the current generation", () => {
		expect(shouldApplyRefresh(1, 1, true)).toBe(false);
	});
});
