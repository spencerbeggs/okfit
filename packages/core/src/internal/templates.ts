import { Frontmatter, Heading, Link, List, ListItem, Markdown, Paragraph, Root, Text } from "@effected/markdown";
import { Yaml } from "@effected/yaml";
import { Result } from "effect";

/** One `index.md` list entry before templating. */
export interface IndexEntryInput {
	readonly title: string;
	readonly target: string;
	readonly description?: string;
}

/** One `index.md` H1 section before rendering: its heading and its entries, in order. */
export interface IndexSectionInput {
	readonly heading: string;
	readonly entries: ReadonlyArray<IndexEntryInput>;
}

/** `* [Title](target) - description`, or without the tail when there is no description (D-36; spec §8). */
const entryNode = (entry: IndexEntryInput): ListItem =>
	ListItem.make({
		spread: false,
		children: [
			Paragraph.make({
				children: [
					Link.make({ url: entry.target, children: [Text.make({ value: entry.title })] }),
					...(entry.description === undefined || entry.description === ""
						? []
						: [Text.make({ value: ` - ${entry.description}` })]),
				],
			}),
		],
	});

/** An H1 heading followed by a tight `*` list of its entries (the spec's own bullet). */
const sectionNodes = (section: IndexSectionInput): ReadonlyArray<Heading | List> => [
	Heading.make({ depth: 1, children: [Text.make({ value: section.heading })] }),
	List.make({ ordered: false, spread: false, bulletChar: "*", children: section.entries.map(entryNode) }),
];

/** Options for {@link indexDocument}. */
export interface IndexDocumentOptions {
	/** The `okf_version` to declare when the root block declares none. */
	readonly okfVersion?: string;
	/** The existing root block's YAML text, re-emitted verbatim; `""` is absent. */
	readonly frontmatter?: string;
}

/** True when `text` parses to a mapping with no own `okf_version` key; a parse failure or non-mapping counts as declaring one. */
const lacksOkfVersion = (text: string): boolean => {
	const parsed = Yaml.parseResult(text);
	if (Result.isFailure(parsed)) return false;
	const value: unknown = parsed.success;
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return !Object.hasOwn(value, "okf_version");
};

/**
 * A whole `index.md`: root frontmatter, then each section.
 *
 * With `frontmatter` the existing block is emitted verbatim, and `okf_version` is prepended only when
 * `okfVersion` is given and the block declares none (a declared version is never rewritten, D6). Without
 * it the block carries only `okf_version` when given (D-21).
 *
 * Rendered by `@effected/markdown`'s emitter, so titles and descriptions are escaped only where markdown
 * would otherwise read them as syntax and round-trip to the original text (issue #72), and a target the
 * emitter cannot write bare (a space, for one) is written in angle brackets.
 */
export const indexDocument = (
	sections: ReadonlyArray<IndexSectionInput>,
	options: IndexDocumentOptions = {},
): string => {
	const { okfVersion } = options;
	// The renderer writes LF everywhere, so a kept CRLF block is normalised to LF.
	const frontmatter = options.frontmatter?.replace(/\r\n?/g, "\n");
	const versionLine =
		okfVersion === undefined
			? undefined
			: Result.getOrThrow(Yaml.stringifyResult({ okf_version: okfVersion })).replace(/\n$/, "");
	const value =
		frontmatter === undefined || frontmatter === ""
			? versionLine
			: versionLine !== undefined && lacksOkfVersion(frontmatter)
				? `${versionLine}\n${frontmatter}`
				: frontmatter;
	const block = value === undefined ? [] : [Frontmatter.make({ format: "yaml", value })];
	const root = Root.make({ children: [...block, ...sections.flatMap(sectionNodes)] });
	return Result.getOrThrow(Markdown.stringifyResult(root));
};

/** `## <date>`, a blank line, then one `* item` line per item (spec §9; S-32, MD022/MD032). */
export const logEntry = (date: string, items: ReadonlyArray<string>): string =>
	`${[`## ${date}`, "", ...items.map((item) => `* ${item}`)].join("\n")}\n`;
