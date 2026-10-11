import { MarkdownEdit } from "@effected/markdown";
import type { GeneratedBlockLocated, GeneratedLocated, Located, TopLevelScalarLocated } from "./locate.js";

/** Every {@link Located} case that names an edit; `unsupported` is unrepresentable here. @internal */
export type SpliceTarget = Exclude<Located, { readonly _tag: "unsupported" }>;

/**
 * One already-encoded attestation: `by` is the branded `Actor` string and
 * `at` the `Timestamp`-encoded ISO string. Neither value is ever passed
 * through a YAML serialiser (V-12).
 *
 * @internal
 */
export interface VerifyEntry {
	readonly by: string;
	readonly at: string;
}

/** `value` wrapped in the quote style the scalar it replaces already uses. @internal */
export const quoteLike = (quote: "plain" | "single-quoted" | "double-quoted", value: string): string =>
	quote === "single-quoted" ? `'${value}'` : quote === "double-quoted" ? `"${value}"` : value;

/** Prefix two spaces to every line but the first, joining with `newline` (V-13). */
const reindent = (original: string, newline: "\n" | "\r\n"): string =>
	original
		.split(/\r\n|\n|\r/)
		.map((line, index) => (index === 0 ? line : `  ${line}`))
		.join(newline);

/**
 * Build the one edit for `target` (contract §3.2). Never calls a YAML
 * stringifier: the only syntax emitted is `- `, `{`, `}`, `: `, `,`,
 * spaces and `newline`.
 *
 * @internal
 */
export const splice = (target: SpliceTarget, entry: VerifyEntry, newline: "\n" | "\r\n"): MarkdownEdit => {
	const flow = `{ by: ${entry.by}, at: ${entry.at} }`;
	const block = (indent: string): string => `${indent}- by: ${entry.by}${newline}${indent}  at: ${entry.at}`;

	switch (target._tag) {
		case "absent":
			// Block style, appended as the LAST top-level key — matching how
			// this repository writes `generated:` (all 31 of them are block
			// mappings; contract §12 note 3).
			return MarkdownEdit.make({
				offset: target.insertAt,
				length: 0,
				content: `verified:${newline}  - by: ${entry.by}${newline}    at: ${entry.at}${newline}`,
			});

		case "blockSeq": {
			const fragment = target.lastItemStyle === "flow" ? `${target.indent}- ${flow}` : block(target.indent);
			return MarkdownEdit.make({
				offset: target.insertAt,
				length: 0,
				content: target.afterNewline ? `${fragment}${newline}` : `${newline}${fragment}`,
			});
		}

		case "flowSeq":
			return MarkdownEdit.make({
				offset: target.insertAt,
				length: 0,
				content: target.empty ? flow : `, ${flow}`,
			});

		case "bareMapping":
			return target.style === "flow"
				? MarkdownEdit.make({
						offset: target.start,
						length: target.end - target.start,
						content: `${newline}${target.indent}- ${target.original}${newline}${target.indent}- ${flow}`,
					})
				: MarkdownEdit.make({
						offset: target.start,
						length: target.end - target.start,
						content: `${newline}${target.indent}- ${reindent(target.original, newline)}${newline}${block(target.indent)}${newline}`,
					});
	}
};

/** The `generated` key {@link spliceGenerated} writes (the body digest lives in `integrity`). @internal */
export type GeneratedFieldName = "at";

/**
 * Build the one edit for `target` (contract §6.1). Never calls a YAML
 * stringifier: the only syntax emitted is the indent, `<field>: `, the
 * preserved quote character (if any), and `newline`. `value` is already
 * encoded by the caller -- `Schema.encodeSync(Timestamp)`'d for `at`, the only
 * field (S-1: splice, never `YamlFormat.
 * modify` — it drops quote style and re-normalises line endings, V-12/V-15
 * violations `sync/generated.ts` cannot afford).
 *
 * @internal
 */
export const spliceGenerated = (
	target: Exclude<GeneratedLocated, { readonly _tag: "unsupported" }>,
	value: string,
	newline: "\n" | "\r\n",
	field: GeneratedFieldName = "at",
): MarkdownEdit => {
	switch (target._tag) {
		case "insertAfterLastKey":
			return MarkdownEdit.make({
				offset: target.insertAt,
				length: 0,
				content: `${target.indent}${field}: ${value}${newline}`,
			});
		case "replaceScalar": {
			return MarkdownEdit.make({
				offset: target.start,
				length: target.end - target.start,
				content: quoteLike(target.quote, value),
			});
		}
	}
};

/**
 * Build the one edit for `target` (a top-level scalar key such as
 * `status`). Never calls a YAML stringifier: the only syntax emitted is
 * `<key>: `, the preserved quote character (if any), and `newline`.
 *
 * @internal
 */
export const spliceTopLevelScalar = (
	target: Exclude<TopLevelScalarLocated, { readonly _tag: "unsupported" }>,
	key: string,
	value: string,
	newline: "\n" | "\r\n",
): MarkdownEdit => {
	switch (target._tag) {
		case "insertAfterKey":
			return MarkdownEdit.make({ offset: target.insertAt, length: 0, content: `${key}: ${value}${newline}` });
		case "replaceScalar": {
			return MarkdownEdit.make({
				offset: target.start,
				length: target.end - target.start,
				content: quoteLike(target.quote, value),
			});
		}
	}
};

/**
 * A whole `generated:` block mapping, appended as the LAST top-level key
 * (issue #73), or written over a null-valued `generated:` line in place
 * (issue #144) — block style, matching how this repository writes every
 * `generated:` and how `splice`'s own `absent` case writes `verified:`.
 *
 * @internal
 */
export const spliceGeneratedBlock = (
	target: Exclude<GeneratedBlockLocated, { readonly _tag: "unsupported" }>,
	fields: { readonly by: string; readonly at: string },
	newline: "\n" | "\r\n",
): MarkdownEdit =>
	MarkdownEdit.make({
		offset: target._tag === "absent" ? target.insertAt : target.start,
		length: target._tag === "absent" ? 0 : target.end - target.start,
		content: `generated:${newline}  by: ${fields.by}${newline}  at: ${fields.at}${newline}`,
	});

/**
 * Issue #185: `okfit verify --stable` splices `status` and `verified` in one
 * write. When `status` is absent it is inserted after `title:` (else `type:`),
 * and when `verified` is absent it is appended as the last key, so both land
 * on the same offset when that anchor is the last key. `MarkdownEdit.applyAll`
 * rejects two zero-length inserts at one offset, the same case
 * `mergeSameOffset`'s own merge, so this folds them into one edit, input
 * order preserved.
 *
 * @internal
 */
export const mergeSameOffset = (edits: ReadonlyArray<MarkdownEdit>): ReadonlyArray<MarkdownEdit> => {
	const out: Array<MarkdownEdit> = [];
	for (const edit of edits) {
		const previous = out.at(-1);
		// A zero-length insert at the offset a later edit starts at (insert or replace) folds into it.
		if (previous !== undefined && previous.length === 0 && previous.offset === edit.offset) {
			out[out.length - 1] = MarkdownEdit.make({
				offset: edit.offset,
				length: edit.length,
				content: previous.content + edit.content,
			});
		} else {
			out.push(edit);
		}
	}
	return out;
};

/**
 * Fold a concept's `verified` edit and optional `status` and `integrity` edits
 * into the ordered, merged edit list both `okfit verify` and `FrontmatterEdits`
 * apply: on equal offsets `status:` comes first, then `verified:`, then
 * `integrity:`. The tie-break is by object identity -- the edits are otherwise
 * indistinguishable.
 *
 * @internal
 */
export const orderVerifyEdits = (
	verifiedEdit: MarkdownEdit,
	statusEdit: MarkdownEdit | undefined,
	integrityEdit?: MarkdownEdit,
): ReadonlyArray<MarkdownEdit> => {
	const rank = (edit: MarkdownEdit): number => (edit === statusEdit ? 0 : edit === integrityEdit ? 2 : 1);
	return mergeSameOffset(
		[
			verifiedEdit,
			...(statusEdit === undefined ? [] : [statusEdit]),
			...(integrityEdit === undefined ? [] : [integrityEdit]),
		].toSorted((a, b) => a.offset - b.offset || rank(a) - rank(b)),
	);
};
