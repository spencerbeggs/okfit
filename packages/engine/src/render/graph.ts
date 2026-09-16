import type { GraphLink, GraphNode, GraphNodeKind } from "@okfit/core";
import { Schema } from "effect";
import { ENGINE_VERSION } from "../version.js";
import type { Distribution } from "./distribution.js";
import { DistributionField } from "./distribution.js";

/** One entry of the `nodes` array. @public */
export const GraphNodeEnvelope = Schema.Struct({
	id: Schema.String,
	kind: Schema.Literals(["concept", "file", "missing"]),
});
/** @public */
export type GraphNodeEnvelope = typeof GraphNodeEnvelope.Type;

/** One entry of the `edges` array; `field` is omitted, never `null` (exactOptionalPropertyTypes). @public */
export const GraphEdgeEnvelope = Schema.Struct({
	from: Schema.String,
	to: Schema.String,
	source: Schema.Literals(["body", "frontmatter"]),
	field: Schema.optionalKey(Schema.String),
	raw: Schema.String,
});
/** @public */
export type GraphEdgeEnvelope = typeof GraphEdgeEnvelope.Type;

/** @public */
export const GraphSummary = Schema.Struct({
	nodes: Schema.Number,
	edges: Schema.Number,
});
/** @public */
export type GraphSummary = typeof GraphSummary.Type;

/**
 * `okfit graph --format json`'s envelope, schema 1, snake_case — the same
 * convention as `render/json.ts`'s `JsonEnvelope`. Built from
 * `LinkGraph.nodes`/`LinkGraph.edges` (D-26).
 *
 * @public
 */
export const GraphEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	engine_version: Schema.String,
	producer: Schema.String,
	distribution: DistributionField,
	okf_version: Schema.String,
	root: Schema.String,
	profile: Schema.NullOr(Schema.String),
	summary: GraphSummary,
	nodes: Schema.Array(GraphNodeEnvelope),
	edges: Schema.Array(GraphEdgeEnvelope),
});
/** @public */
export type GraphEnvelope = typeof GraphEnvelope.Type;

const toNode = (node: GraphNode): GraphNodeEnvelope => ({ id: node.id, kind: node.kind as GraphNodeKind });

const toEdge = (edge: GraphLink): GraphEdgeEnvelope => ({
	from: edge.from,
	to: edge.to,
	source: edge.data.source,
	// exactOptionalPropertyTypes: omit the key rather than set it to undefined (CORE/internal/lintRules.ts:40).
	...(edge.data.field === undefined ? {} : { field: edge.data.field }),
	raw: edge.data.raw,
});

/**
 * Build the envelope from a loaded `LinkGraph`'s own `nodes`/`edges`
 * arrays.
 *
 * @public
 */
export const graphEnvelope = (input: {
	readonly okfitVersion: string;
	readonly producer: string;
	readonly okfVersion: string;
	readonly root: string;
	readonly profile: string | null;
	readonly nodes: ReadonlyArray<GraphNode>;
	readonly edges: ReadonlyArray<GraphLink>;
	readonly distribution?: Distribution;
}): GraphEnvelope => ({
	schema: 1,
	okfit_version: input.okfitVersion,
	engine_version: ENGINE_VERSION,
	producer: input.producer,
	distribution: input.distribution ?? null,
	okf_version: input.okfVersion,
	root: input.root,
	profile: input.profile,
	summary: { nodes: input.nodes.length, edges: input.edges.length },
	nodes: input.nodes.map(toNode),
	edges: input.edges.map(toEdge),
});
