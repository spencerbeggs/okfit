// The frontmatter offset shift (D-14). Offset to line/character is the kit's
// `LineIndex` (`@effected/source`), used by `DiagnosticRange.fromOffset`.

const LF = 0x0a;
const CR = 0x0d;

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
