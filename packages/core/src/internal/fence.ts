import { FrontmatterSource } from "@effected/markdown";

/**
 * Whether a file opens a YAML frontmatter block and whether it closes (D-13).
 *
 * @public
 */
export type FenceState = "absent" | "unclosed" | "closed";

/**
 * Core's fence check, run before the markdown parser because the parser treats an unclosed fence as
 * no frontmatter (effected-markdown.md section 2). The fence state is `FrontmatterSource.split`'s;
 * core recognizes only the `---` YAML fence (D-13), so a `+++` or `---json` fence reads as absent.
 *
 * @public
 */
export const detectFence = (text: string): FenceState => {
	const split = FrontmatterSource.split(text);
	return split.fenceFormat === undefined || split.fenceFormat === "yaml" ? (split.fence ?? "absent") : "absent";
};
