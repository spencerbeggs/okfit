import { MarkdownDocument, MarkdownEdit } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import type { Status } from "@okfit/core";
import { DiagnosticRange } from "@okfit/core";
import { Effect, Result, Runtime, Schema } from "effect";
import { formatDigest, locateIntegrity, spliceIntegrityVerified } from "../verify/integrity.js";
import { documentNewline, locate, locateTopLevelScalar, stripBom } from "../verify/locate.js";
import { orderVerifyEdits, splice, spliceTopLevelScalar } from "../verify/splice.js";

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

/** The value of a located scalar's raw source text, quotes removed. */
const unquote = (raw: string, quote: "plain" | "single-quoted" | "double-quoted"): string =>
	quote === "plain" ? raw.trim() : raw.slice(1, -1);

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

	/**
	 * Edits that append one verified entry and bind it with `integrity.verified`
	 * (`content` is the content digest of the source as passed), the same splice
	 * `okfit verify` performs. Only the `verified` slot of an existing `integrity`
	 * block is rewritten.
	 */
	static readonly verified = (
		source: string,
		entry: { readonly by: string; readonly at: string },
		content: string,
	): Effect.Effect<ReadonlyArray<MarkdownEdit>, YamlParseError | UnsupportedFrontmatterError> =>
		Effect.gen(function* () {
			const { text, bom } = stripBom(source);
			const target = yield* locate(text);
			if (target._tag === "unsupported") {
				return yield* new UnsupportedFrontmatterError({ key: "verified", shape: target.shape });
			}
			const newline = documentNewline(text);
			const verifiedEdit = splice(target, entry, newline);
			const integrity = yield* locateIntegrity(text);
			if (integrity._tag === "unsupported") {
				return yield* new UnsupportedFrontmatterError({ key: "integrity", shape: integrity.shape });
			}
			const integrityEdit = spliceIntegrityVerified(integrity, text, { ...entry, content }, newline);
			return orderVerifyEdits(verifiedEdit, undefined, integrityEdit).map((edit) => shift(edit, bom.length));
		});

	/**
	 * Edits that append one verified entry, bind it with `integrity.verified` AND set top-level
	 * `status`, the combined write `okfit verify --stable` performs. A `status` scalar already
	 * equal to `status` makes no status edit, and equal-offset inserts are merged with `status:`
	 * first, then `verified:`, then `integrity:`. Unlike the CLI, which reads the parsed status,
	 * this always locates `status`, so an unsupported shape on it fails even when its value
	 * already matches.
	 */
	static readonly verifiedWithStatus = (
		source: string,
		entry: { readonly by: string; readonly at: string },
		status: Status,
		content: string,
	): Effect.Effect<ReadonlyArray<MarkdownEdit>, YamlParseError | UnsupportedFrontmatterError> =>
		Effect.gen(function* () {
			const { text, bom } = stripBom(source);
			const located = yield* locate(text);
			if (located._tag === "unsupported") {
				return yield* new UnsupportedFrontmatterError({ key: "verified", shape: located.shape });
			}
			const newline = documentNewline(text);
			const verifiedEdit = splice(located, entry, newline);
			let statusEdit: MarkdownEdit | undefined;
			const target = yield* locateTopLevelScalar(text, "status");
			if (target._tag === "unsupported") {
				return yield* new UnsupportedFrontmatterError({ key: "status", shape: target.shape });
			}
			if (target._tag !== "replaceScalar" || unquote(text.slice(target.start, target.end), target.quote) !== status) {
				statusEdit = spliceTopLevelScalar(target, "status", status, newline);
			}
			const integrity = yield* locateIntegrity(text);
			if (integrity._tag === "unsupported") {
				return yield* new UnsupportedFrontmatterError({ key: "integrity", shape: integrity.shape });
			}
			const integrityEdit = spliceIntegrityVerified(integrity, text, { ...entry, content }, newline);
			return orderVerifyEdits(verifiedEdit, statusEdit, integrityEdit).map((edit) => shift(edit, bom.length));
		});

	/**
	 * Edits that stamp `renders[i].body` with `digests[i]` (16 hex, quoted when numeric-looking): an
	 * existing value is replaced in place, a missing key is inserted on the line after
	 * `renders[i].path` at that key's column. An `undefined` digest skips its entry. A legacy `renders[i].body_sha256` line in the same
	 * entry is removed, so an entry never ends up with both keys. Block-style `renders` only; flow
	 * style fails with `UnsupportedFrontmatterError`.
	 */
	static readonly rendersDigests = (
		source: string,
		digests: ReadonlyArray<string | undefined>,
	): Effect.Effect<ReadonlyArray<MarkdownEdit>, YamlParseError | UnsupportedFrontmatterError> =>
		Effect.gen(function* () {
			const { text, bom } = stripBom(source);
			const unsupported = (shape: string) => new UnsupportedFrontmatterError({ key: "renders", shape });
			const parsed = MarkdownDocument.parseResult(text, { frontmatter: true });
			if (Result.isFailure(parsed)) return yield* unsupported("unparseable");
			const document = parsed.success;
			const block = DiagnosticRange.forFrontmatterPath(document, []);
			const rendersSpan = DiagnosticRange.forFrontmatterPath(document, ["renders"]);
			if (block === undefined || rendersSpan === undefined || rendersSpan.offset === block.offset) {
				return yield* unsupported("absent");
			}
			if (text.charAt(rendersSpan.offset) === "[") return yield* unsupported("flow-sequence");
			const newline = documentNewline(text);
			const edits: Array<MarkdownEdit> = [];
			for (const [index, digest] of digests.entries()) {
				// `undefined` leaves that entry untouched (a migration that only converts legacy entries).
				if (digest === undefined) continue;
				const formatted = formatDigest(digest);
				const legacySpan = DiagnosticRange.forFrontmatterPath(document, ["renders", index, "body_sha256"]);
				if (legacySpan !== undefined && legacySpan.offset !== block.offset) {
					const start = text.lastIndexOf("\n", legacySpan.offset - 1) + 1;
					const nl = text.indexOf("\n", legacySpan.offset + legacySpan.length);
					const end = nl === -1 ? text.length : nl + 1;
					const prefix = text.slice(start, legacySpan.offset);
					if (!/^[ ]*(?:-[ ]+)*(?:"body_sha256"|'body_sha256'|body_sha256)[ ]*:[ ]*$/u.test(prefix)) {
						return yield* unsupported("flow-mapping");
					}
					// A dash-prefixed key line cannot be removed whole; only a dedicated line is.
					if (prefix.includes("-")) return yield* unsupported("dash-prefixed-key");
					edits.push(shift(MarkdownEdit.make({ offset: start, length: end - start, content: "" }), bom.length));
				}
				const digestSpan = DiagnosticRange.forFrontmatterPath(document, ["renders", index, "body"]);
				if (digestSpan !== undefined && digestSpan.offset !== block.offset) {
					const content = digestSpan.length === 0 ? ` ${formatted}` : formatted;
					edits.push(
						shift(MarkdownEdit.make({ offset: digestSpan.offset, length: digestSpan.length, content }), bom.length),
					);
					continue;
				}
				const pathSpan = DiagnosticRange.forFrontmatterPath(document, ["renders", index, "path"]);
				if (pathSpan === undefined || pathSpan.offset === block.offset) return yield* unsupported("missing-path");
				const lineStart = text.lastIndexOf("\n", pathSpan.offset - 1) + 1;
				const prefix = /^[ ]*(?:-[ ]+)*(?:"path"|'path'|path)[ ]*:[ ]*$/u.exec(text.slice(lineStart, pathSpan.offset));
				if (prefix === null) return yield* unsupported("flow-mapping");
				const column = /^[ ]*(?:-[ ]+)*/u.exec(prefix[0])?.[0].length ?? 0;
				const newlineAt = text.indexOf("\n", pathSpan.offset + pathSpan.length);
				const lineEnd =
					newlineAt === -1
						? text.length
						: newlineAt > 0 && text.charAt(newlineAt - 1) === "\r"
							? newlineAt - 1
							: newlineAt;
				edits.push(
					shift(
						MarkdownEdit.make({
							offset: lineEnd,
							length: 0,
							content: `${newline}${" ".repeat(column)}body: ${formatted}`,
						}),
						bom.length,
					),
				);
			}
			return edits.toSorted((a, b) => a.offset - b.offset);
		});
}
