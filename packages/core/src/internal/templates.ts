/** One `index.md` list entry before templating. */
export interface IndexEntryInput {
	readonly title: string;
	readonly target: string;
	readonly description?: string;
}

/**
 * Backslash-escape markdown-active characters (`\`, `<`, `>`, `*`, `_`, `` ` ``,
 * `[`, `]`) so plain text round-trips through a generated `index.md` as
 * literal text instead of being interpreted as inline HTML or emphasis
 * (issue #72). `\` is escaped first so the escapes added for the other
 * characters are not themselves re-escaped.
 */
const escapeMarkdown = (text: string): string => text.replace(/[\\<>*_`[\]]/g, (char) => `\\${char}`);

/** `* [Title](target) - description`, or without the tail when there is no description (D-36; spec §8). */
export const indexEntry = (entry: IndexEntryInput): string =>
	entry.description === undefined || entry.description === ""
		? `* [${escapeMarkdown(entry.title)}](${entry.target})`
		: `* [${escapeMarkdown(entry.title)}](${entry.target}) - ${escapeMarkdown(entry.description)}`;

/** An H1 section: heading, blank line, entries, trailing newline. */
export const indexSection = (heading: string, entries: ReadonlyArray<string>): string =>
	`# ${heading}\n\n${entries.join("\n")}\n`;

/** Root-index frontmatter carrying only `okf_version` (D-21). */
export const indexFrontmatter = (okfVersion: string): string => `---\nokf_version: "${okfVersion}"\n---\n\n`;

/** `## <date>`, a blank line, then one `* item` line per item (spec §9; S-32, MD022/MD032). */
export const logEntry = (date: string, items: ReadonlyArray<string>): string =>
	`${[`## ${date}`, "", ...items.map((item) => `* ${item}`)].join("\n")}\n`;
