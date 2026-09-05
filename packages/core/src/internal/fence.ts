import { FRONTMATTER_FENCE } from "./position.js";

/**
 * Whether a file opens a YAML frontmatter block and whether it closes (D-13).
 *
 * @public
 */
export type FenceState = "absent" | "unclosed" | "closed";

const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Core's own fence check, run before the markdown parser because the parser treats an
 * unclosed fence as no frontmatter (effected-markdown.md section 2). Line 0 must be
 * exactly `---`; the block closes at the first later line that is exactly `---`.
 *
 * @public
 */
export const detectFence = (text: string): FenceState => {
	const lines = text.split(LINE_BREAK);
	if (lines[0] !== FRONTMATTER_FENCE) return "absent";
	for (let index = 1; index < lines.length; index += 1) {
		if (lines[index] === FRONTMATTER_FENCE) return "closed";
	}
	return "unclosed";
};
