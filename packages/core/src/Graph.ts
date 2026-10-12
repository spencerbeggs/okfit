import { Graph as EffectGraph, Option, Schema } from "effect";
import type { LoadedBundle, LoadedConcept } from "./Bundle.js";
import { DiagnosticRange } from "./Diagnostic.js";
import type { BundleIndex, LinkResolution as InternalLinkResolution } from "./internal/links.js";
import { frontmatterFieldSpan, pathFieldsOf, resolvePathField, resolveTarget } from "./internal/links.js";

/**
 * Kind of a graph node: a loaded concept, an existing non-concept file (including reserved
 * `index.md`/`log.md`), or a placeholder for a target that does not exist (D-25).
 *
 * @public
 */
export const GraphNodeKind = Schema.Literals(["concept", "file", "missing"]);

/** @public */
export type GraphNodeKind = typeof GraphNodeKind.Type;

/** Frontmatter fields whose value is a bundle path (D-23). @public */
export type PathField = "resource" | "sources.resource" | "computation" | "executor.resource" | "attester.resource";

/**
 * How one reference resolved (D-23, D-24); `via` says which D-23 branch produced a node: `rooted` (a leading
 * `/`), `file` (against the linking file's directory) or `root` (a bare path against the bundle root).
 *
 * @public
 */
export type LinkResolution =
	| { readonly _tag: "url" }
	| { readonly _tag: "self" }
	| { readonly _tag: "external" }
	| { readonly _tag: "descriptor" }
	| {
			readonly _tag: "node";
			readonly id: string;
			readonly kind: GraphNodeKind;
			readonly via: "rooted" | "file" | "root";
	  };

// Compile-time check that the public type and the internal implementation type stay identical.
const _sameResolution = (value: InternalLinkResolution): LinkResolution => value;
const _sameResolutionBack = (value: LinkResolution): InternalLinkResolution => value;
void _sameResolution;
void _sameResolutionBack;

/** A node: a concept id, or a bundle-relative path with extension for `file` and `missing` nodes. @public */
export interface GraphNode {
	readonly id: string;
	readonly kind: GraphNodeKind;
}

/** Edge data (D-25): where the link was written, its raw text, and its span in the linking file when locatable. @public */
export interface GraphEdge {
	readonly source: "body" | "frontmatter";
	readonly field?: PathField;
	readonly raw: string;
	readonly position?: DiagnosticRange;
}

/** An edge with its endpoints as node ids. @public */
export interface GraphLink {
	readonly from: string;
	readonly to: string;
	readonly data: GraphEdge;
}

interface PendingEdge {
	readonly to: string;
	readonly kind: GraphNodeKind;
	readonly data: GraphEdge;
}

const edgesOf = (concept: LoadedConcept, lookup: BundleIndex): ReadonlyArray<PendingEdge> => {
	const out: Array<PendingEdge> = [];
	const text = concept.document.source;
	for (const ref of pathFieldsOf(concept.frontmatter)) {
		const resolved = resolvePathField(concept.path, ref.field, ref.raw, lookup);
		if (resolved._tag !== "node") continue;
		const span = frontmatterFieldSpan(concept.document, ref.raw);
		const position = span === undefined ? {} : { position: DiagnosticRange.fromOffset(text, span.offset, span.length) };
		out.push({
			to: resolved.id,
			kind: resolved.kind,
			data: { source: "frontmatter", field: ref.field, raw: ref.raw, ...position },
		});
	}
	for (const link of concept.document.links) {
		if (link.url === undefined || link.node.type === "linkReference" || link.node.type === "imageReference") continue;
		const resolved = resolveTarget(concept.path, link.url, lookup);
		if (resolved._tag !== "node") continue;
		const { start, end } = link.node.position;
		const position = DiagnosticRange.fromOffset(text, start.offset, end.offset - start.offset);
		out.push({ to: resolved.id, kind: resolved.kind, data: { source: "body", raw: link.url, position } });
	}
	return out;
};

const defaultLabels = { nodeLabel: (node: GraphNode) => node.id, edgeLabel: (edge: GraphEdge) => edge.field ?? "" };

/**
 * The link graph of a bundle over `effect/Graph` (D-26). `graph` is the underlying directed graph for
 * `dfs`, `topo`, `stronglyConnectedComponents`; `index` maps node ids to `NodeIndex`.
 *
 * @public
 */
export class LinkGraph {
	readonly graph: EffectGraph.DirectedGraph<GraphNode, GraphEdge>;
	readonly index: ReadonlyMap<string, EffectGraph.NodeIndex>;
	readonly nodes: ReadonlyArray<GraphNode>;
	readonly edges: ReadonlyArray<GraphLink>;

	private constructor(
		graph: EffectGraph.DirectedGraph<GraphNode, GraphEdge>,
		index: ReadonlyMap<string, EffectGraph.NodeIndex>,
	) {
		this.graph = graph;
		this.index = index;
		const byIndex = new Map(EffectGraph.entries(EffectGraph.nodes(graph)));
		this.nodes = [...byIndex.values()];
		this.edges = Array.from(EffectGraph.values(EffectGraph.edges(graph)), (edge) => ({
			from: byIndex.get(edge.source)?.id ?? "",
			to: byIndex.get(edge.target)?.id ?? "",
			data: edge.data,
		}));
	}

	/** @internal */
	static readonly _make = (
		graph: EffectGraph.DirectedGraph<GraphNode, GraphEdge>,
		index: ReadonlyMap<string, EffectGraph.NodeIndex>,
	): LinkGraph => new LinkGraph(graph, index);

	/** The node with `id`, if present. */
	node(id: string): Option.Option<GraphNode> {
		const at = this.index.get(id);
		return at === undefined ? Option.none() : EffectGraph.getNode(this.graph, at);
	}

	/** Unique targets of outgoing edges; `[]` for an unknown id. */
	successors(id: string): ReadonlyArray<GraphNode> {
		return this.neighbours(id, (graph, at) => EffectGraph.successors(graph, at));
	}

	/** Unique sources of incoming edges; `[]` for an unknown id. */
	predecessors(id: string): ReadonlyArray<GraphNode> {
		return this.neighbours(id, (graph, at) => EffectGraph.predecessors(graph, at));
	}

	/** Edges whose target is a `missing` node; the input of lint `broken-links`. */
	dangling(): ReadonlyArray<GraphLink> {
		return this.edges.filter((link) => Option.exists(this.node(link.to), (node) => node.kind === "missing"));
	}

	/** Mermaid flowchart; nodes labelled by id, frontmatter edges by field. */
	toMermaid(options?: EffectGraph.MermaidOptions<GraphNode, GraphEdge>): string {
		return EffectGraph.toMermaid(this.graph, { ...defaultLabels, ...options });
	}

	/** GraphViz DOT; same labelling defaults as `toMermaid`. */
	toGraphViz(options?: EffectGraph.GraphVizOptions<GraphNode, GraphEdge>): string {
		return EffectGraph.toGraphViz(this.graph, { ...defaultLabels, ...options });
	}

	private neighbours(
		id: string,
		pick: (
			graph: EffectGraph.DirectedGraph<GraphNode, GraphEdge>,
			at: EffectGraph.NodeIndex,
		) => Array<EffectGraph.NodeIndex>,
	): ReadonlyArray<GraphNode> {
		const at = this.index.get(id);
		if (at === undefined) return [];
		return [...new Set(pick(this.graph, at))].flatMap((next) => Option.toArray(EffectGraph.getNode(this.graph, next)));
	}
}

const indexes = new WeakMap<LoadedBundle, BundleIndex>();

/** The lookup sets for one loaded bundle, built once: a bundle is immutable after load. */
const indexOf = (bundle: LoadedBundle): BundleIndex => {
	const cached = indexes.get(bundle);
	if (cached !== undefined) return cached;
	const built: BundleIndex = { files: new Set(bundle.files), concepts: new Set<string>(bundle.concepts.keys()) };
	indexes.set(bundle, built);
	return built;
};

/**
 * Static facade building a {@link LinkGraph} from a loaded bundle (D-6).
 *
 * @public
 */
export class Graph {
	private constructor() {}

	/**
	 * Pure. Resolve `raw`, written in the file at bundle-relative `from`, the way the graph does; `field`
	 * applies the path-field rules (a `sources.resource` descriptor).
	 */
	static readonly resolve = (bundle: LoadedBundle, from: string, raw: string, field?: PathField): LinkResolution => {
		const lookup = indexOf(bundle);
		return field === undefined ? resolveTarget(from, raw, lookup) : resolvePathField(from, field, raw, lookup);
	};

	/**
	 * Pure. Body links come from `document.links`, path fields from the frontmatter (D-23, D-24).
	 * Placeholder `missing` nodes are added before their edge because `Graph.addEdge` throws on an absent endpoint.
	 */
	static readonly fromBundle = (bundle: LoadedBundle): LinkGraph => {
		const lookup: BundleIndex = { files: new Set(bundle.files), concepts: new Set<string>(bundle.concepts.keys()) };
		const index = new Map<string, EffectGraph.NodeIndex>();
		const graph = EffectGraph.directed<GraphNode, GraphEdge>((mutable) => {
			const node = (id: string, kind: GraphNodeKind): EffectGraph.NodeIndex => {
				const found = index.get(id);
				if (found !== undefined) return found;
				const created = EffectGraph.addNode(mutable, { id, kind });
				index.set(id, created);
				return created;
			};
			for (const id of bundle.concepts.keys()) node(id, "concept");
			for (const [id, concept] of bundle.concepts) {
				const from = node(id, "concept");
				for (const edge of edgesOf(concept, lookup))
					EffectGraph.addEdge(mutable, from, node(edge.to, edge.kind), edge.data);
			}
		});
		return LinkGraph._make(graph, index);
	};
}
