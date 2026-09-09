/**
 * Whole-file text scanners backing `__test__/boundaries.test.ts` (K-9, K-39).
 * Test-only helpers, not part of the package's public surface.
 */

/**
 * Matches one whole `import`/`export` statement whose `from` specifier is
 * `@effected/app` — namespace (`import * as App from …`), re-export
 * (`export { App } from …`), default (`import App, { AppConfig } from …`),
 * and named (wrapped or not) all start with the `import`/`export` keyword
 * and end at the first semicolon after the `from` clause, so bounding the
 * match on `[^;]*?` keeps it inside one statement (this codebase's lint
 * config requires a terminating semicolon) without needing to model every
 * import grammar form individually.
 */
const APP_STATEMENT = /\b(?:import|export)\b[^;]*?\bfrom\s*["']@effected\/app["'][^;]*;/g;

/** K-9's forbidden names: importing any of these from `@effected/app` is disallowed. */
const FORBIDDEN_NAMES = ["App", "AppStore", "AppCache"];

/**
 * Every K-9-forbidden name (`App`, `AppStore`, `AppCache`) that appears,
 * as its own word, in any `@effected/app` import/export statement in
 * `contents` — across the whole file, and across every import form, not
 * just a braced named-import list. The bare keyword `type` is stripped
 * from each matched statement first (an inline `import type { App } from …`
 * or `{ type App }` still names `App`; stripping only removes the keyword
 * token, never the name itself), then each forbidden name is tested with
 * its own `\b`-bounded regex so `AppConfig` never matches `App`.
 */
export const findAppImportNames = (contents: string): ReadonlyArray<string> => {
	const names: Array<string> = [];
	for (const match of contents.matchAll(APP_STATEMENT)) {
		const statement = match[0].replace(/\btype\b/g, "");
		for (const name of FORBIDDEN_NAMES) {
			if (!names.includes(name) && new RegExp(`\\b${name}\\b`).test(statement)) {
				names.push(name);
			}
		}
	}
	return names;
};

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
