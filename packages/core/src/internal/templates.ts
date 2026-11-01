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

/**
 * A whole `index.md`: root frontmatter carrying only `okf_version` when given (D-21), then each section.
 *
 * Rendered by `@effected/markdown`'s emitter, so titles and descriptions are escaped only where markdown
 * would otherwise read them as syntax and round-trip to the original text (issue #72), and a target the
 * emitter cannot write bare (a space, for one) is written in angle brackets.
 */
export const indexDocument = (sections: ReadonlyArray<IndexSectionInput>, okfVersion?: string): string => {
	const frontmatter =
		okfVersion === undefined
			? []
			: [
					Frontmatter.make({
						format: "yaml",
						value: Result.getOrThrow(Yaml.stringifyResult({ okf_version: okfVersion })).replace(/\n$/, ""),
					}),
				];
	const root = Root.make({ children: [...frontmatter, ...sections.flatMap(sectionNodes)] });
	return Result.getOrThrow(Markdown.stringifyResult(root));
};

/** `## <date>`, a blank line, then one `* item` line per item (spec §9; S-32, MD022/MD032). */
export const logEntry = (date: string, items: ReadonlyArray<string>): string =>
	`${[`## ${date}`, "", ...items.map((item) => `* ${item}`)].join("\n")}\n`;
