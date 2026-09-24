import { basename } from "node:path";
import type { ConceptSummary, ConceptsResult } from "./wire.js";

export type Status = "draft" | "stable" | "deprecated";

export type TreeNode =
	| {
			readonly kind: "bundle";
			readonly root: string;
			readonly label: string;
			readonly description: string;
			readonly children: ReadonlyArray<TreeNode>;
	  }
	| {
			readonly kind: "type";
			readonly root: string;
			readonly type: string;
			readonly label: string;
			readonly count: number;
			readonly children: ReadonlyArray<TreeNode>;
	  }
	| {
			readonly kind: "concept";
			readonly id: string;
			readonly uri: string;
			readonly label: string;
			readonly description: string;
			readonly type: string;
			readonly stale: boolean;
			readonly status: Status;
	  };

const ICONS: Readonly<Record<string, string>> = {
	Consumer: "plug",
	Convention: "checklist",
	DataModel: "database",
	Decision: "law",
	Glossary: "book",
	Gotcha: "warning",
	Incident: "flame",
	Interface: "symbol-interface",
	Invariant: "shield",
	Limitation: "circle-slash",
	Measurement: "graph",
	Module: "package",
	Project: "home",
	Reference: "link-external",
	Roadmap: "milestone",
	Runbook: "list-ordered",
};

export const iconFor = (type: string): string => ICONS[type] ?? "symbol-misc";

const conceptNode = (c: ConceptSummary): Extract<TreeNode, { kind: "concept" }> => {
	const status: Status = c.status ?? "stable";
	return {
		kind: "concept",
		id: c.id,
		uri: c.uri,
		label: c.title,
		description: status,
		type: c.type,
		stale: c.stale,
		status,
	};
};

const typeNodes = (root: string, concepts: ReadonlyArray<ConceptSummary>): ReadonlyArray<TreeNode> => {
	const groups = new Map<string, Array<Extract<TreeNode, { kind: "concept" }>>>();
	for (const c of concepts) {
		const list = groups.get(c.type) ?? [];
		list.push(conceptNode(c));
		groups.set(c.type, list);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([type, children]) => ({ kind: "type", root, type, label: type, count: children.length, children }));
};

/** One bundle node per root when more than one bundle is live; with one bundle, the type groups sit at the top. */
export const buildTree = (result: ConceptsResult): ReadonlyArray<TreeNode> => {
	if (result.bundles.length === 0) return [];
	const [only, ...rest] = result.bundles;
	if (only !== undefined && rest.length === 0) {
		return typeNodes(only.root, only.concepts);
	}
	return result.bundles.map((b) => ({
		kind: "bundle",
		root: b.root,
		label: basename(b.root),
		description: b.root,
		children: typeNodes(b.root, b.concepts),
	}));
};

export const staleCount = (result: ConceptsResult): number =>
	result.bundles.reduce((n, b) => n + b.concepts.filter((c) => c.stale).length, 0);

export const decorationFor = (
	node: Extract<TreeNode, { kind: "concept" }>,
): { badge: string; tooltip: string } | undefined => {
	if (node.stale) return { badge: "S", tooltip: "Stale" };
	if (node.status === "draft") return { badge: "D", tooltip: "Draft" };
	if (node.status === "deprecated") return { badge: "X", tooltip: "Deprecated" };
	return undefined;
};

/**
 * Whether an in-flight `refresh()`'s result -- minted at generation
 * `requested` -- should still be applied. A later `refresh()` call bumps the
 * provider's own generation past `requested` before this one resolves, so an
 * out-of-order response is dropped rather than clobbering a newer one; a
 * disposed provider never applies anything, regardless of generation. Pure,
 * so `ConceptsProvider.refresh()` can be exercised without a live `vscode`
 * host or a real `LanguageClient`.
 */
export const shouldApplyRefresh = (requested: number, current: number, disposed: boolean): boolean =>
	!disposed && requested === current;
