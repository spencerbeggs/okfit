import { ContextTag, ContextType } from "@okfit/cli";
import { Schema } from "effect";

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
