// Offset to zero-based line/character over file text, and the frontmatter
// offset shift (D-14). markdown and yaml keep their equivalents private, so
// core owns this loop (diagnostic-range-and-position-mapping.md sections 2-3).

const LF = 0x0a;
const CR = 0x0d;

/** A zero-based line and UTF-16 character position. @public */
export interface LineCharacter {
	readonly line: number;
	readonly character: number;
}

/** Line and character of `offset` within `text`; `\n`, `\r` and `\r\n` each count as one line break. @public */
export const lineCharacter = (text: string, offset: number): LineCharacter => {
	let line = 0;
	let lineStart = 0;
	const limit = Math.min(offset, text.length);
	for (let i = 0; i < limit; i++) {
		const code = text.charCodeAt(i);
		if (code === LF) {
			line++;
			lineStart = i + 1;
		} else if (code === CR) {
			if (i + 1 < text.length && text.charCodeAt(i + 1) === LF) i++;
			line++;
			lineStart = i + 1;
		}
	}
	return { line, character: offset - lineStart };
};

/** The only frontmatter fence core recognizes (D-13). @public */
export const FRONTMATTER_FENCE = "---";

/**
 * File offset of the first frontmatter value character: the opening fence
 * plus its terminator (`\r\n` counts two, `\n` or `\r` one). Only meaningful
 * when `text` starts with the fence.
 *
 * @public
 */
export const frontmatterValueStart = (text: string): number => {
	const afterFence = FRONTMATTER_FENCE.length;
	const isCrLf = text.charCodeAt(afterFence) === CR && text.charCodeAt(afterFence + 1) === LF;
	return afterFence + (isCrLf ? 2 : 1);
};

/** Map a `YamlDiagnostic.offset` or `YamlNode.offset` inside the frontmatter value to a whole-file offset. @public */
export const toFileOffset = (text: string, yamlOffset: number): number => frontmatterValueStart(text) + yamlOffset;
