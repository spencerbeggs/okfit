/**
 * Whole-file text scanners backing `__test__/boundaries.test.ts`.
 * Test-only helpers, not part of the package's public surface.
 */

/** The three quote characters a string or template literal can open with. */
const isQuote = (char: string): boolean => char === '"' || char === "'" || char === "`";

/**
 * Removes every `//` line comment and `/* … *‍/` block comment (TSDoc
 * included) from `contents`, so prose that happens to use a bare word like
 * "process" can never trip a source-text scan looking for real code —
 * without also treating a `//` or `/*` that appears INSIDE a string or
 * template literal (`"http://x"`, `` `/* not a comment *‍/` ``) as a
 * comment start. Walks the text once as a small state machine, tracking
 * whether it is currently inside a `"`, `'`, or backtick literal (honouring
 * a backslash escape at the simple level — enough for real source, not a
 * full parser) and only recognising comment markers outside one.
 *
 * A stripped block comment is replaced with a single space rather than
 * deleted outright, so two tokens either side of it (`foo/* c *‍/bar`)
 * never fuse into one word.
 */
export const stripComments = (contents: string): string => {
	let result = "";
	let index = 0;
	const { length } = contents;
	while (index < length) {
		const char = contents[index];
		if (isQuote(char)) {
			const quote = char;
			result += char;
			index++;
			while (index < length) {
				const inner = contents[index];
				if (inner === "\\") {
					result += inner;
					index++;
					if (index < length) {
						result += contents[index];
						index++;
					}
					continue;
				}
				result += inner;
				index++;
				if (inner === quote) break;
			}
			continue;
		}
		const two = contents.slice(index, index + 2);
		if (two === "//") {
			while (index < length && contents[index] !== "\n") index++;
			continue;
		}
		if (two === "/*") {
			index += 2;
			while (index < length && contents.slice(index, index + 2) !== "*/") index++;
			index += 2;
			result += " ";
			continue;
		}
		result += char;
		index++;
	}
	return result;
};
