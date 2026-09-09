import { MarkdownEdit } from "@effected/markdown";
import type { GeneratedLocated, Located } from "./locate.js";

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

/** Either `generated` key {@link spliceGenerated} and {@link spliceGeneratedFields} write. @internal */
export type GeneratedFieldName = "at" | "body_sha256";

/**
 * Build the one edit for `target` (contract §6.1). Never calls a YAML
 * stringifier: the only syntax emitted is the indent, `<field>: `, the
 * preserved quote character (if any), and `newline`. `value` is already
 * encoded by the caller -- `Schema.encodeSync(Timestamp)`'d for `at`, the raw
 * lowercase hex digest for `body_sha256` (S-1: splice, never `YamlFormat.
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
			const quoted =
				target.quote === "single-quoted" ? `'${value}'` : target.quote === "double-quoted" ? `"${value}"` : value;
			return MarkdownEdit.make({ offset: target.start, length: target.end - target.start, content: quoted });
		}
	}
};

/**
 * Build the edit(s) that write BOTH `generated.at` and `generated.
 * body_sha256` together (issue #19: `sync/generated.ts` never writes one
 * without the other). Each field's own `spliceGenerated` edit is used when
 * the two land at different offsets; when both are absent they resolve to
 * the identical `insertAfterLastKey` anchor (the mapping's last existing
 * key), and inserting two zero-length edits at the same offset is exactly
 * the "overlapping edits" case `MarkdownEdit.applyAll` treats as a
 * programmer error -- so that one case is merged into a single edit whose
 * content carries both lines, `at` first.
 *
 * @internal
 */
export const spliceGeneratedFields = (
	atTarget: Exclude<GeneratedLocated, { readonly _tag: "unsupported" }>,
	bodySha256Target: Exclude<GeneratedLocated, { readonly _tag: "unsupported" }>,
	encodedAt: string,
	bodySha256: string,
	newline: "\n" | "\r\n",
): ReadonlyArray<MarkdownEdit> => {
	if (
		atTarget._tag === "insertAfterLastKey" &&
		bodySha256Target._tag === "insertAfterLastKey" &&
		atTarget.insertAt === bodySha256Target.insertAt
	) {
		return [
			MarkdownEdit.make({
				offset: atTarget.insertAt,
				length: 0,
				content: `${atTarget.indent}at: ${encodedAt}${newline}${bodySha256Target.indent}body_sha256: ${bodySha256}${newline}`,
			}),
		];
	}
	return [
		spliceGenerated(atTarget, encodedAt, newline, "at"),
		spliceGenerated(bodySha256Target, bodySha256, newline, "body_sha256"),
	];
};
