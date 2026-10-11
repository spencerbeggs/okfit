import { FrontmatterSource } from "@effected/markdown";

// P-6: CRLF and lone CR to LF, then trailing whitespace at end of text removed.
const normalise = (text: string): string => text.replace(/\r\n?/g, "\n").trimEnd();

/**
 * The normalised body of a concept source (`FrontmatterSource.split(text).body`, then P-6 normalisation).
 *
 * @internal
 */
export const body = (text: string): string => normalise(FrontmatterSource.split(text).body);
