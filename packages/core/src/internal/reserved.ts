import type { Heading, Link, ListItem, MarkdownDocument, PhrasingContent, Position } from "@effected/markdown";
import { MarkdownParseOptions } from "@effected/markdown";
import { Option } from "effect";
import type { ConformanceCode, DiagnosticSeverity, LintCode } from "../Diagnostic.js";
import { Diagnostic, DiagnosticRange } from "../Diagnostic.js";
import { IndexDocument, IndexEntry, IndexSection } from "../IndexDocument.js";
import { LogDocument, LogGroup, LogItem } from "../LogDocument.js";
import { OkfVersion } from "../OkfVersion.js";
import { findFrontmatterPathSpan } from "./yamlPathSpan.js";

/**
 * What an unquoted `okf_version` number says: the text the author wrote (`source`, or what YAML read when the text is
 * unavailable), what YAML read it as (`reads`), and whether the text is a `<major>.<minor>` pair that can be quoted as is.
 */
const unquotedMessage = (source: string, reads: string, isPair: boolean): string => {
	const quoteAs = isPair ? source : "<major>.<minor>";
	return source === reads
		? `okf_version ${source} is an unquoted number; quote it as "${quoteAs}"`
		: `okf_version ${source} is an unquoted number, which YAML reads as ${reads}; quote it as "${quoteAs}"`;
};

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
	const metadata: {
		okfVersion?: string;
		title?: string;
		description?: string;
		license?: string;
		metadata?: Record<string, unknown>;
		frontmatter?: string;
	} = {};
	const node = Option.getOrUndefined(document.frontmatter);
	if (node !== undefined && Option.isSome(input.frontmatter)) {
		const raw = input.frontmatter.value;
		const record =
			raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
		if (dir !== "") {
			diagnostics.push(
				diagnostic(
					file,
					"index-frontmatter",
					"error",
					"index.md below the bundle root must not carry frontmatter",
					rangeOf(text, node.position),
				),
			);
		} else if (raw === null) {
			// An empty block is no metadata.
		} else if (record === undefined) {
			diagnostics.push(
				diagnostic(
					file,
					"index-frontmatter",
					"error",
					"root index.md frontmatter must be a mapping",
					rangeOf(text, node.position),
				),
			);
		} else {
			metadata.metadata = record;
			metadata.frontmatter = node.value;
			const warn = (key: string, message: string): void => {
				diagnostics.push(
					diagnostic(
						file,
						"index-metadata-invalid",
						"warning",
						message,
						DiagnosticRange.forFrontmatterPath(document, [key]) ?? rangeOf(text, node.position),
					),
				);
			};
			const version = record.okf_version;
			if (typeof version === "string") {
				if (version !== "") {
					metadata.okfVersion = version;
					if (Option.isNone(OkfVersion.parse(version)))
						warn("okf_version", `okf_version "${version}" is not a <major>.<minor> version`);
				}
			} else if (typeof version === "number") {
				// An unquoted number declares the text its author wrote, because YAML has already turned `0.10` into 0.1 and a
				// version is a `<major>.<minor>` pair, not a number (§8.1: "A quoted string"). The declaration still counts
				// by what the author wrote (§11.2 rule 4 keeps a value outside its vocabulary, §12.1 keys the fallbacks on
				// what a bundle "declares"): text that is not a pair (`.2`, `0.2e0`, `1e1`) declares no readable version, so
				// it does not parse and reads as current (§12). YAML's reading is only the fallback when no text is found.
				const span = findFrontmatterPathSpan(text, node, ["okf_version"]);
				const reads = String(version);
				const source = span === undefined ? reads : text.slice(span.offset, span.offset + span.length);
				const isPair = Option.isSome(OkfVersion.parse(source));
				metadata.okfVersion = source;
				warn("okf_version", unquotedMessage(source, reads, isPair));
			} else if (version !== null && version !== undefined) {
				metadata.okfVersion = JSON.stringify(version);
				warn("okf_version", "okf_version must be a quoted <major>.<minor> string");
			}
			for (const key of ["title", "description", "license"] as const) {
				const value = record[key];
				if (typeof value === "string") {
					if (value !== "") metadata[key] = value;
				} else if (value !== null && value !== undefined) warn(key, `${key} must be a string`);
			}
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
		if (current === undefined) {
			if (block.type === "list")
				diagnostics.push(
					diagnostic(
						file,
						"index-malformed",
						"error",
						"index entries appear before any section heading",
						rangeOf(text, block.position),
					),
				);
			continue;
		}
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
	const fields = { path: file, dir, sections, source: text };
	return { document: IndexDocument.make({ ...fields, ...metadata }), diagnostics };
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
	if (Option.isSome(document.frontmatter)) {
		diagnostics.push(
			diagnostic(
				file,
				"log-frontmatter",
				"warning",
				"log.md carries frontmatter; the spec defines none",
				rangeOf(text, document.frontmatter.value.position),
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
	const fields = { path: file, dir, groups, source: text };
	return { document: LogDocument.make(title === undefined ? fields : { ...fields, title }), diagnostics };
};
