// The frontmatter offset shift (D-14): `@effected/markdown`'s `FrontmatterSource.split` places the
// value in the file. Offset to line/character is the kit's `LineIndex` (`@effected/source`), used by
// `DiagnosticRange.fromOffset`.

import { FrontmatterSource } from "@effected/markdown";

/**
 * Map a `YamlDiagnostic.offset` or `YamlNode.offset` inside the frontmatter value to a whole-file
 * offset. Only meaningful when `text` opens a closed frontmatter block.
 *
 * @public
 */
export const toFileOffset = (text: string, yamlOffset: number): number =>
	(FrontmatterSource.split(text).frontmatter?.valueStart ?? 0) + yamlOffset;
