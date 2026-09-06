import { ContextTag, ContextType } from "@okfit/cli";
import { Status } from "@okfit/core";
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
