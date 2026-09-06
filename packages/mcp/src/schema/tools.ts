import { ContextTag, ContextType } from "@okfit/cli";
import { GraphNodeKind, Status } from "@okfit/core";
import { Schema } from "effect";
import { ConceptSummary } from "./ConceptSummary.js";

/** `describe_vocabulary`'s result (§5.2). @public */
export const DescribeVocabularySuccess = Schema.Struct({
	project_root: Schema.String,
	bundle_root: Schema.String,
	config_path: Schema.NullOr(Schema.String),
	profile: Schema.NullOr(Schema.String),
	profile_requested: Schema.NullOr(Schema.String),
	agent: Schema.NullOr(Schema.String),
	types: Schema.Array(ContextType),
	tags: Schema.Array(ContextTag),
});
/** @public */
export type DescribeVocabularySuccess = typeof DescribeVocabularySuccess.Type;

/** `list_concepts`' arguments (§5.3). @public */
export const ListConceptsParams = Schema.Struct({
	type: Schema.optionalKey(Schema.String),
	tags: Schema.optionalKey(Schema.Array(Schema.String)),
	status: Schema.optionalKey(Status),
	limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
	offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
/** @public */
export type ListConceptsParams = typeof ListConceptsParams.Type;

/** `list_concepts`' result: the page, plus the match count before paging. @public */
export const ListConceptsSuccess = Schema.Struct({
	items: Schema.Array(ConceptSummary),
	total: Schema.Int,
});
/** @public */
export type ListConceptsSuccess = typeof ListConceptsSuccess.Type;

/** `get_concept`'s result (§5.4). @public */
export const GetConceptSuccess = Schema.Struct({
	id: Schema.String,
	type: Schema.String,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	status: Status,
	tags: Schema.Array(Schema.String),
	path: Schema.String,
	frontmatter: Schema.Record(Schema.String, Schema.Unknown),
	raw: Schema.String,
	links: Schema.Array(
		Schema.Struct({
			to: Schema.String,
			kind: GraphNodeKind,
			source: Schema.Literals(["body", "frontmatter"]),
			field: Schema.optionalKey(Schema.String),
		}),
	),
});
/** @public */
export type GetConceptSuccess = typeof GetConceptSuccess.Type;

/** One graph neighbour: flat, with a nullable summary (J-4). @public */
export const Neighbor = Schema.Struct({
	id: Schema.String,
	kind: GraphNodeKind,
	summary: Schema.NullOr(ConceptSummary),
});
/** @public */
export type Neighbor = typeof Neighbor.Type;

/** `concept_neighbors`' result (§5.5). @public */
export const ConceptNeighborsSuccess = Schema.Struct({
	outgoing: Schema.Array(Neighbor),
	incoming: Schema.Array(Neighbor),
});
/** @public */
export type ConceptNeighborsSuccess = typeof ConceptNeighborsSuccess.Type;

/** `stale_report`'s arguments: an optional ISO instant, decoded in the handler (J-5). @public */
export const StaleReportParams = Schema.Struct({ now: Schema.optionalKey(Schema.String) });
/** @public */
export type StaleReportParams = typeof StaleReportParams.Type;

/** `stale_report`'s result (§5.6). @public */
export const StaleReportSuccess = Schema.Struct({
	as_of: Schema.String,
	items: Schema.Array(
		Schema.Struct({
			summary: ConceptSummary,
			stale_after: Schema.String,
			days_past: Schema.Int,
		}),
	),
});
/** @public */
export type StaleReportSuccess = typeof StaleReportSuccess.Type;

/** `validate_bundle`'s arguments: the same shape and decode path as stale_report. @public */
export const ValidateBundleParams = Schema.Struct({ now: Schema.optionalKey(Schema.String) });
/** @public */
export type ValidateBundleParams = typeof ValidateBundleParams.Type;
