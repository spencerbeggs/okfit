import type { Heading, Link, ListItem, MarkdownDocument, PhrasingContent, Position } from "@effected/markdown";
import { MarkdownParseOptions } from "@effected/markdown";
import { Option } from "effect";
import type { ConformanceCode, DiagnosticSeverity, LintCode } from "../Diagnostic.js";
import { Diagnostic, DiagnosticRange } from "../Diagnostic.js";
import { IndexDocument, IndexEntry, IndexSection } from "../IndexDocument.js";
import { LogDocument, LogGroup, LogItem } from "../LogDocument.js";

/**
 * The one parse configuration every OKF file uses: GFM with frontmatter capture
 * (effected-markdown.md section 1; `Markdown.ts:60-62`).
 *
 * @public
 */
export const OPTIONS = MarkdownParseOptions.make({ frontmatter: true });

/**
 * A reserved file handed to the parsers by `Bundle.load`.
 *
 * @public
 */
export interface ReservedFileInput {
	readonly file: string;
	readonly dir: string;
	readonly document: MarkdownDocument;
}

/**
 * A typed reserved document plus the diagnostics its shape produced (D-21).
 *
 * @public
 */
export interface ReservedParse<A> {
	readonly document: A;
	readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DESCRIPTION_LEAD = /^[-–—:]\s*/;

const rangeOf = (text: string, position: Position): DiagnosticRange =>
	DiagnosticRange.fromOffset(text, position.start.offset, position.end.offset - position.start.offset);

const diagnostic = (
	file: string,
	code: ConformanceCode | LintCode,
	severity: DiagnosticSeverity,
	message: string,
	range: DiagnosticRange,
): Diagnostic => Diagnostic.make({ file, code, severity, message, range });

/**
 * Plain text of phrasing nodes: text and code values, recursing into containers
 * (the derivation `DocumentHeading.text` uses, MarkdownDocument.ts:248-279).
 *
 * @public
 */
export const phrasingText = (nodes: ReadonlyArray<PhrasingContent>): string =>
	nodes
		.map((node) => {
			if (node.type === "text" || node.type === "inlineCode") return node.value;
			if ("children" in node) return phrasingText(node.children);
			return "";
		})
		.join("");

const isLink = (node: PhrasingContent): node is Link => node.type === "link";

const indexEntry = (text: string, item: ListItem): IndexEntry | undefined => {
	const paragraph = item.children[0];
	if (paragraph === undefined || paragraph.type !== "paragraph") return undefined;
	const at = paragraph.children.findIndex(isLink);
	const link = paragraph.children[at];
	if (link === undefined || !isLink(link)) return undefined;
	const description = phrasingText(paragraph.children.slice(at + 1))
		.trim()
		.replace(DESCRIPTION_LEAD, "")
		.trim();
	const fields = { title: phrasingText(link.children).trim(), target: link.url, range: rangeOf(text, item.position) };
	return IndexEntry.make(description === "" ? fields : { ...fields, description });
};

/**
 * Parse an `index.md` (D-21; okf-spec-rules-and-sample-bundles.md section 2.1).
 * `frontmatter` is the decoded YAML value when the file had a closed, parseable block.
 *
 * @public
 */
export const parseIndex = (
	input: ReservedFileInput & { readonly frontmatter: Option.Option<unknown> },
): ReservedParse<IndexDocument> => {
	const { file, dir, document } = input;
	const text = document.source;
	const diagnostics: Array<Diagnostic> = [];
	let okfVersion: string | undefined;
	const node = document.frontmatter;
	if (node !== undefined && Option.isSome(input.frontmatter)) {
		const raw = input.frontmatter.value;
		const record =
			raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
		const keys = record === undefined ? [] : Object.keys(record);
		if (dir === "" && record !== undefined && keys.length === 1 && typeof record.okf_version === "string") {
			okfVersion = record.okf_version;
		} else {
			const message =
				dir === ""
					? 'root index.md frontmatter may only carry a string "okf_version"'
					: "index.md below the bundle root must not carry frontmatter";
			diagnostics.push(diagnostic(file, "index-frontmatter", "error", message, rangeOf(text, node.position)));
		}
	}
	const sections: Array<IndexSection> = [];
	let current: { readonly heading: Heading; readonly entries: Array<IndexEntry> } | undefined;
	const flush = (end: number): void => {
		if (current === undefined) return;
		const start = current.heading.position.start.offset;
		sections.push(
			IndexSection.make({
				heading: phrasingText(current.heading.children).trim(),
				entries: current.entries,
				range: DiagnosticRange.fromOffset(text, start, end - start),
			}),
		);
	};
	for (const block of document.root.children) {
		if (block.type === "frontmatter" || block.type === "mdxjsEsm") continue;
		if (block.type === "heading" && block.depth === 1) {
			flush(block.position.start.offset);
			current = { heading: block, entries: [] };
			continue;
		}
		if (current === undefined) continue;
		if (block.type !== "list") {
			diagnostics.push(
				diagnostic(
					file,
					"index-malformed",
					"error",
					`expected a list under "# ${phrasingText(current.heading.children).trim()}", found ${block.type}`,
					rangeOf(text, block.position),
				),
			);
			continue;
		}
		for (const item of block.children) {
			const entry = indexEntry(text, item);
			if (entry === undefined)
				diagnostics.push(
					diagnostic(file, "index-malformed", "error", "index entry has no link", rangeOf(text, item.position)),
				);
			else current.entries.push(entry);
		}
	}
	flush(text.length);
	const fields = { path: file, dir, sections };
	return { document: IndexDocument.make(okfVersion === undefined ? fields : { ...fields, okfVersion }), diagnostics };
};

/**
 * Parse a `log.md` (D-21; okf-spec-rules-and-sample-bundles.md section 2.2). Any
 * frontmatter is `log-frontmatter` (warning) and is never decoded.
 *
 * @public
 */
export const parseLog = (input: ReservedFileInput): ReservedParse<LogDocument> => {
	const { file, dir, document } = input;
	const text = document.source;
	const diagnostics: Array<Diagnostic> = [];
	if (document.frontmatter !== undefined) {
		diagnostics.push(
			diagnostic(
				file,
				"log-frontmatter",
				"warning",
				"log.md carries frontmatter; the spec defines none",
				rangeOf(text, document.frontmatter.position),
			),
		);
	}
	let title: string | undefined;
	const groups: Array<LogGroup> = [];
	let current: { readonly heading: Heading; readonly date: string; readonly items: Array<LogItem> } | undefined;
	let skipping = false;
	const flush = (end: number): void => {
		if (current === undefined) return;
		const start = current.heading.position.start.offset;
		groups.push(
			LogGroup.make({
				date: current.date,
				items: current.items,
				range: DiagnosticRange.fromOffset(text, start, end - start),
			}),
		);
		current = undefined;
	};
	for (const block of document.root.children) {
		if (block.type === "frontmatter" || block.type === "mdxjsEsm") continue;
		if (block.type === "heading" && block.depth === 1) {
			title ??= phrasingText(block.children).trim();
			continue;
		}
		if (block.type === "heading" && block.depth === 2) {
			flush(block.position.start.offset);
			const date = phrasingText(block.children).trim();
			skipping = !DATE_RE.test(date);
			if (skipping)
				diagnostics.push(
					diagnostic(
						file,
						"log-heading-invalid",
						"error",
						`log heading "${date}" is not a YYYY-MM-DD date`,
						rangeOf(text, block.position),
					),
				);
			else current = { heading: block, date, items: [] };
			continue;
		}
		if (skipping) continue;
		if (current === undefined) {
			if (block.type === "list")
				diagnostics.push(
					diagnostic(
						file,
						"log-malformed",
						"error",
						"log entries appear before any date heading",
						rangeOf(text, block.position),
					),
				);
			continue;
		}
		if (block.type !== "list") {
			diagnostics.push(
				diagnostic(
					file,
					"log-malformed",
					"error",
					`expected a list under "## ${current.date}", found ${block.type}`,
					rangeOf(text, block.position),
				),
			);
			continue;
		}
		for (const item of block.children) {
			const paragraph = item.children[0];
			if (paragraph === undefined || paragraph.type !== "paragraph") {
				diagnostics.push(
					diagnostic(file, "log-malformed", "error", "log item does not start with text", rangeOf(text, item.position)),
				);
				continue;
			}
			current.items.push(
				LogItem.make({
					text: text.slice(paragraph.position.start.offset, paragraph.position.end.offset),
					range: rangeOf(text, item.position),
				}),
			);
		}
	}
	flush(text.length);
	const fields = { path: file, dir, groups };
	return { document: LogDocument.make(title === undefined ? fields : { ...fields, title }), diagnostics };
};
