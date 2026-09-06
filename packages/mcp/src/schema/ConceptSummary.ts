import type { LoadedConcept } from "@okfit/core";
import { Derive, Status } from "@okfit/core";
import { Schema } from "effect";

/** The seven-field shape every list-like tool result carries (N-16). @public */
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
