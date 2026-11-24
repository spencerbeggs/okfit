import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

/**
 * The only files that may spell okfit's own frontmatter keys: the constant for `integrity`, the profile field
 * table, and the legacy-spelling module the migration reads (not yet created; allowlisted ahead of it).
 */
const ALLOWED: ReadonlySet<string> = new Set([
	"packages/core/src/Integrity.ts",
	"packages/profiles/src/ProfileKeys.ts",
	"packages/engine/src/sync/legacyKeys.ts",
]);

/**
 * A quoted `integrity` or a quoted `integrity:` (the key line okfit writes), the frontmatter key itself. It does
 * not match the derived signal's display text such as `` `integrity: ${state}` `` or `"integrity: drifted"`
 * (`okfit query` prints that vocabulary: current, drifted, none), which has text after the colon.
 */
const INTEGRITY_LITERAL = /["'`]integrity(?:["'`]|:["'`])/;
/** A quoted profile field name that the `integrity` pattern does not cover. */
const FIELD_LITERAL = /["'](renders|surface|links_to)["']/;

/** The text of `source` with line and block comments blanked; string, template and regex-free scanning. */
const stripComments = (source: string): string => {
	let out = "";
	let i = 0;
	let quote: string | undefined;
	while (i < source.length) {
		const ch = source.charAt(i);
		const next = source.charAt(i + 1);
		if (quote !== undefined) {
			out += ch;
			if (ch === "\\") {
				out += next;
				i += 2;
				continue;
			}
			if (ch === quote) quote = undefined;
			i += 1;
		} else if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			out += ch;
			i += 1;
		} else if (ch === "/" && next === "/") {
			while (i < source.length && source.charAt(i) !== "\n") i += 1;
		} else if (ch === "/" && next === "*") {
			const end = source.indexOf("*/", i + 2);
			const stop = end === -1 ? source.length : end + 2;
			out += source.slice(i, stop).replace(/[^\n]/g, " ");
			i = stop;
		} else {
			out += ch;
			i += 1;
		}
	}
	return out;
};

const literalsIn = (source: string): ReadonlyArray<string> => {
	const text = stripComments(source);
	return [INTEGRITY_LITERAL, FIELD_LITERAL].flatMap((pattern) => {
		const match = pattern.exec(text);
		return match === null ? [] : [match[0]];
	});
};

const walk = (dir: string, extensions: ReadonlyArray<string>): ReadonlyArray<string> =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return walk(path, extensions);
		return extensions.some((ext) => name.endsWith(ext)) ? [path] : [];
	});

const sourceFiles = (): ReadonlyArray<string> => [
	...readdirSync(join(ROOT, "packages")).flatMap((pkg) => {
		const src = join(ROOT, "packages", pkg, "src");
		return pathExists(src) ? walk(src, [".ts", ".tsx"]) : [];
	}),
	...walk(join(ROOT, "vscode", "src"), [".ts"]),
];

function pathExists(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

describe("okfit's frontmatter keys are spelled in one place per package", () => {
	it("the matcher finds a literal and ignores comments (positive control)", () => {
		expect(literalsIn('const k = "integrity";')).toEqual(['"integrity"']);
		expect(literalsIn("const k = `integrity:`;")).toEqual(["`integrity:`"]);
		expect(literalsIn("const d = `integrity: state`; const e = 'integrity: drifted';")).toEqual([]);
		expect(literalsIn("const k = 'renders';")).toEqual(["'renders'"]);
		expect(literalsIn('// "integrity"\n/* "surface" */ const k = 1;')).toEqual([]);
		expect(literalsIn('const url = "https://x.test"; const k = "links_to";')).toEqual(['"links_to"']);
	});

	it("no source file outside the allowlist holds a quoted key literal, non-vacuously", () => {
		const files = sourceFiles();
		expect(files.length).toBeGreaterThan(100);
		for (const allowed of ALLOWED) {
			// The allowlisted files that exist must be scanned like any other; legacyKeys.ts arrives in a later task.
			if (allowed.endsWith("legacyKeys.ts")) continue;
			expect(files.map((file) => relative(ROOT, file))).toContain(allowed);
		}
		const offenders = files
			.map((file) => ({ file: relative(ROOT, file), hits: literalsIn(readFileSync(file, "utf8")) }))
			.filter(({ file, hits }) => !ALLOWED.has(file) && hits.length > 0);
		expect(offenders).toEqual([]);
	});
});
