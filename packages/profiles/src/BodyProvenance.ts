import { Timestamp } from "@okfit/core";
import { Schema } from "effect";

/**
 * The body is at HEAD and last changed in the commit described here (P-9).
 * `at` is that commit's author date (P-4); `committedAt` and the author
 * identity are carried for callers that want a history-based policy later (P-40).
 *
 * @public
 */
export const BodyCommitted = Schema.TaggedStruct("committed", {
	at: Timestamp,
	sha: Schema.String,
	committedAt: Timestamp,
	authorName: Schema.String,
	authorEmail: Schema.String,
});

/**
 * The body has no usable commit (P-9): `untracked` means HEAD does not contain
 * the path, `dirty` means the on-disk body differs from HEAD's blob, `unborn`
 * means HEAD has no commits (P-11).
 *
 * @public
 */
export const BodyUncommitted = Schema.TaggedStruct("uncommitted", {
	reason: Schema.Literals(["untracked", "dirty", "unborn"]),
});

/**
 * What {@link Derivation.generatedAt} reports. A schema so the value also
 * serialises for MCP later without adaptation. Derivation never substitutes
 * `now`; the uncommitted policy is the caller's (P-10).
 *
 * @public
 */
export const BodyProvenance = Schema.Union([BodyCommitted, BodyUncommitted]);

/**
 * The type of {@link (BodyProvenance:variable)}.
 *
 * @public
 */
export type BodyProvenance = typeof BodyProvenance.Type;

/**
 * Why a body is uncommitted (P-9).
 *
 * @public
 */
export type UncommittedReason = typeof BodyUncommitted.fields.reason.Type;
