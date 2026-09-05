/**
 * Whole-file text scanners backing `__test__/boundaries.test.ts` (K-9, K-39).
 * Test-only helpers, not part of the package's public surface.
 */

/**
 * Matches an `import`/`import type` statement whose named-import braces are
 * followed by a `from "@effected/app"` (or `'...'`) specifier, with the `s`
 * flag so the brace group can span multiple lines — exactly what Biome
 * produces for a long named-import list (`import {\n\tApp,\n} from
 * "@effected/app";`). A line-scoped check misses this; this one does not.
 */
const IMPORT_FROM_APP = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@effected\/app["']/gs;

/**
 * Every name imported from `@effected/app` anywhere in `contents`, across
 * the whole file rather than one line at a time. Strips an inline `type `
 * prefix and an `as alias`, keeping only the name as it is exported by the
 * module — the name the K-9 forbidden list (`App`, `AppStore`, `AppCache`)
 * checks against.
 */
export const findAppImportNames = (contents: string): ReadonlyArray<string> => {
	const names: Array<string> = [];
	for (const match of contents.matchAll(IMPORT_FROM_APP)) {
		const namedImports = match[1] ?? "";
		for (const raw of namedImports.split(",")) {
			const trimmed = raw.trim();
			if (trimmed.length === 0) continue;
			const withoutType = trimmed.replace(/^type\s+/, "");
			const [name] = withoutType.split(/\s+as\s+/);
			if (name !== undefined && name.trim().length > 0) names.push(name.trim());
		}
	}
	return names;
};

/**
 * Removes every `//` line comment and `/* … *‍/` block comment (TSDoc
 * included) from `contents`, so prose that happens to use a bare word like
 * "process" can never trip a source-text scan looking for real code.
 */
export const stripComments = (contents: string): string =>
	contents.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
