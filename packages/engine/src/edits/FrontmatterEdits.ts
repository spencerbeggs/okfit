import { MarkdownEdit } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import type { Status } from "@okfit/core";
import { Effect, Runtime, Schema } from "effect";
import { documentNewline, locate, locateTopLevelScalar, stripBom } from "../verify/locate.js";
import { splice, spliceTopLevelScalar } from "../verify/splice.js";

/**
 * A top-level frontmatter key `FrontmatterEdits` was asked to edit turned
 * out to be a shape it cannot splice: `shape` is whichever locator string
 * `verify/locate.ts` produced for that key (e.g. `"flow-mapping"`,
 * `"alias"`, `"status-block-scalar"`). The file is never touched when this
 * is raised -- callers should surface it and let a human edit by hand.
 *
 * @public
 */
export class UnsupportedFrontmatterError extends Schema.TaggedError<UnsupportedFrontmatterError>()(
	"UnsupportedFrontmatterError",
	{ key: Schema.String, shape: Schema.String },
) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		return `"${this.key}"'s frontmatter value is a shape FrontmatterEdits cannot edit (${this.shape}); edit it by hand`;
	}
}

/** `edit` shifted forward by `by` bytes, or `edit` itself when `by` is zero. */
const shift = (edit: MarkdownEdit, by: number): MarkdownEdit =>
	by === 0 ? edit : MarkdownEdit.make({ offset: edit.offset + by, length: edit.length, content: edit.content });

/**
 * A public facade over the `verify/locate.ts` and `verify/splice.ts`
 * machinery: byte-range `MarkdownEdit`s for a concept's top-level `status`
 * scalar and its `verified` list. `verified` builds the exact same edit
 * `okfit verify`'s `prepareVerify` builds -- same `locate`, same `splice`,
 * same `documentNewline` newline choice -- so its output matches
 * `okfit verify`'s splice byte for byte; `status` reuses the identical
 * newline rule for consistency, over `locateTopLevelScalar` and
 * `spliceTopLevelScalar` instead.
 *
 * Every offset returned is a WHOLE-FILE offset into `source` AS PASSED --
 * BOM included when present -- so a caller can apply the edits with
 * `MarkdownEdit.applyAll(source, edits)` directly, or map them to editor
 * ranges without adjustment. Internally the BOM is stripped for parsing and
 * its length added back to every offset before returning.
 *
 * @public
 */
export class FrontmatterEdits {
	private constructor() {}

	/** Edits that set top-level `status` to `status`, replacing an existing scalar or inserting after `title:` (else `type:`). */
	static readonly status = (
		source: string,
		status: Status,
	): Effect.Effect<ReadonlyArray<MarkdownEdit>, YamlParseError | UnsupportedFrontmatterError> =>
		Effect.gen(function* () {
			const { text, bom } = stripBom(source);
			const target = yield* locateTopLevelScalar(text, "status");
			if (target._tag === "unsupported") {
				return yield* new UnsupportedFrontmatterError({ key: "status", shape: target.shape });
			}
			const edit = spliceTopLevelScalar(target, "status", status, documentNewline(text));
			return [shift(edit, bom.length)];
		});

	/** Edits that append one verified entry, the same splice `okfit verify` performs. */
	static readonly verified = (
		source: string,
		entry: { readonly by: string; readonly at: string },
	): Effect.Effect<ReadonlyArray<MarkdownEdit>, YamlParseError | UnsupportedFrontmatterError> =>
		Effect.gen(function* () {
			const { text, bom } = stripBom(source);
			const target = yield* locate(text);
			if (target._tag === "unsupported") {
				return yield* new UnsupportedFrontmatterError({ key: "verified", shape: target.shape });
			}
			const edit = splice(target, entry, documentNewline(text));
			return [shift(edit, bom.length)];
		});
}
