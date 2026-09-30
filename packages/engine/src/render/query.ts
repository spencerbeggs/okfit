import type { LoadedConcept } from "@okfit/core";
import { Derive, GraphNodeKind, Status } from "@okfit/core";
import { Schema } from "effect";
import { ENGINE_VERSION } from "../version.js";
import type { Distribution } from "./distribution.js";
import { DistributionField } from "./distribution.js";

/** The seven-field shape every list-like query result carries (N-16). @public */
export const ConceptSummary = Schema.Struct({
	id: Schema.String,
	type: Schema.String,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	status: Status,
	tags: Schema.Array(Schema.String),
	path: Schema.String,
});
/** @public */
export type ConceptSummary = typeof ConceptSummary.Type;

/** Project one loaded concept into its summary. @public */
export const toConceptSummary = (concept: LoadedConcept): ConceptSummary => ({
	id: concept.id,
	type: concept.frontmatter.type,
	title: Derive.title(concept),
	description: concept.frontmatter.description ?? null,
	status: Derive.status(concept.frontmatter),
	tags: [...(concept.frontmatter.tags ?? [])],
	path: concept.path,
});

/** `okfit query list --format json`'s envelope, schema 1, snake_case. @public */
export const QueryListEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	engine_version: Schema.String,
	distribution: DistributionField,
	total: Schema.Int,
	items: Schema.Array(ConceptSummary),
});
/** @public */
export type QueryListEnvelope = typeof QueryListEnvelope.Type;

/** One outgoing link of a concept, as `okfit query get` reports it. @public */
export const QueryLink = Schema.Struct({
	to: Schema.String,
	kind: GraphNodeKind,
	source: Schema.Literals(["body", "frontmatter"]),
	field: Schema.optionalKey(Schema.String),
});
/** @public */
export type QueryLink = typeof QueryLink.Type;

/** `okfit query get --format json`'s envelope, schema 1, snake_case. @public */
export const QueryGetEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	engine_version: Schema.String,
	distribution: DistributionField,
	concept: Schema.Struct({
		...ConceptSummary.fields,
		frontmatter: Schema.Record(Schema.String, Schema.Unknown),
		links: Schema.Array(QueryLink),
	}),
});
/** @public */
export type QueryGetEnvelope = typeof QueryGetEnvelope.Type;

/** One neighbour of a concept; `summary` is `null` for a non-concept node. @public */
export const QueryNeighbor = Schema.Struct({
	id: Schema.String,
	kind: GraphNodeKind,
	summary: Schema.NullOr(ConceptSummary),
});
/** @public */
export type QueryNeighbor = typeof QueryNeighbor.Type;

/** `okfit query neighbors --format json`'s envelope, schema 1, snake_case. @public */
export const QueryNeighborsEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	engine_version: Schema.String,
	distribution: DistributionField,
	id: Schema.String,
	outgoing: Schema.Array(QueryNeighbor),
	incoming: Schema.Array(QueryNeighbor),
});
/** @public */
export type QueryNeighborsEnvelope = typeof QueryNeighborsEnvelope.Type;

/** Build the list envelope; `items` is the already-paged, already-sorted summaries. @public */
export const queryListEnvelope = (input: {
	readonly okfitVersion: string;
	readonly total: number;
	readonly items: ReadonlyArray<ConceptSummary>;
	readonly distribution?: Distribution;
}): QueryListEnvelope => ({
	schema: 1,
	okfit_version: input.okfitVersion,
	engine_version: ENGINE_VERSION,
	distribution: input.distribution ?? null,
	total: input.total,
	items: input.items,
});

/** Build the get envelope from a summary, the raw frontmatter and the outgoing links. @public */
export const queryGetEnvelope = (input: {
	readonly okfitVersion: string;
	readonly concept: ConceptSummary;
	readonly frontmatter: Readonly<Record<string, unknown>>;
	readonly links: ReadonlyArray<QueryLink>;
	readonly distribution?: Distribution;
}): QueryGetEnvelope => ({
	schema: 1,
	okfit_version: input.okfitVersion,
	engine_version: ENGINE_VERSION,
	distribution: input.distribution ?? null,
	concept: { ...input.concept, frontmatter: input.frontmatter, links: input.links },
});

/** Build the neighbors envelope. @public */
export const queryNeighborsEnvelope = (input: {
	readonly okfitVersion: string;
	readonly id: string;
	readonly outgoing: ReadonlyArray<QueryNeighbor>;
	readonly incoming: ReadonlyArray<QueryNeighbor>;
	readonly distribution?: Distribution;
}): QueryNeighborsEnvelope => ({
	schema: 1,
	okfit_version: input.okfitVersion,
	engine_version: ENGINE_VERSION,
	distribution: input.distribution ?? null,
	id: input.id,
	outgoing: input.outgoing,
	incoming: input.incoming,
});
