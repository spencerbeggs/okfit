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

/**
 * Build the one edit for `target` (contract §6.1). Never calls a YAML
 * stringifier: the only syntax emitted is the indent, `at: `, the
 * preserved quote character (if any), and `newline`. `encodedAt` is
 * already `Schema.encodeSync(Timestamp)`'d by the caller (S-1: splice,
 * never `YamlFormat.modify` — it drops quote style and re-normalises line
 * endings, V-12/V-15 violations `sync/generated.ts` cannot afford).
 *
 * @internal
 */
export const spliceGenerated = (
	target: Exclude<GeneratedLocated, { readonly _tag: "unsupported" }>,
	encodedAt: string,
	newline: "\n" | "\r\n",
): MarkdownEdit => {
	switch (target._tag) {
		case "insertAfterLastKey":
			return MarkdownEdit.make({
				offset: target.insertAt,
				length: 0,
				content: `${target.indent}at: ${encodedAt}${newline}`,
			});
		case "replaceScalar": {
			const quoted =
				target.quote === "single-quoted"
					? `'${encodedAt}'`
					: target.quote === "double-quoted"
						? `"${encodedAt}"`
						: encodedAt;
			return MarkdownEdit.make({ offset: target.start, length: target.end - target.start, content: quoted });
		}
	}
};
