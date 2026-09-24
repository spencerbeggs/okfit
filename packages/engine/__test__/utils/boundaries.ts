/**
 * Whole-file text scanner backing `__test__/boundaries.test.ts` (K-9).
 * Test-only helper, not part of the package's public surface.
 *
 * The K-39 `process`-read scanner this file used to also carry
 * (`stripComments`, used only for that check) is gone: `SourceBoundary`
 * from `@effected/workspaces/testing` replaces it, and this package's
 * remaining check -- forbidding named imports from an otherwise-legitimate
 * `@effected/app` module -- has no `SourceBoundary` rule equivalent (its
 * `forbidImports` only forbids a whole specifier), so it stays hand-rolled.
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
