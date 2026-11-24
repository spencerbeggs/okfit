import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

/**
 * The only files that may spell okfit's own frontmatter keys: the constant for `integrity`, the profile field
 * table, and the legacy-spelling module the migration reads, the one home of the old spelling.
 */
const ALLOWED: ReadonlySet<string> = new Set([
	"packages/core/src/Integrity.ts",
	"packages/profiles/src/ProfileKeys.ts",
	"packages/engine/src/sync/legacyKeys.ts",
]);

/**
 * A quoted `integrity`, a quoted `integrity:` (the key line okfit writes, closed or followed by an escaped
 * newline), or a template literal that opens with `integrity:` and an interpolation. It does not match the
 * derived signal's display text such as `` `integrity: ${state}` `` or `"integrity: drifted"`, which has a
 * space after the colon.
 */
const INTEGRITY_LITERAL = /["'`]integrity(?:["'`]|:(?:["'`]|\\n|\$\{))/;

/** The 18 built-in profile field names (`PROFILE_FIELD_NAMES`), split by how distinctive each is as a word. */
const DISTINCTIVE = [
	"links_to",
	"renders",
	"supersedes",
	"justifies",
	"runbooks",
	"crosses",
	"pins",
	"bounds",
	"occurred",
	"audience",
	"repository",
	"surface",
] as const;
/** Common words: scanned only in quoted form, since `kind: "path"` and `url` appear everywhere as other things. */
const COMMON = ["kind", "layer", "gate", "guard", "url", "entry"] as const;

const distinctive = DISTINCTIVE.join("|");
const common = COMMON.join("|");
/** A quoted field name; an unquoted object key (at the start of a line or after `{`, `,` or `(`); a member read. The first covers bracket reads too. */
const FIELD_PATTERNS: ReadonlyArray<RegExp> = [
	new RegExp(`["'\`](?:${distinctive}|${common})["'\`]`),
	new RegExp(`(?<=(?:^|[{,(])\\s*)(?:${distinctive})\\s*:`),
	new RegExp(`(?<!ProfileKeys)\\.(?:${distinctive})\\b`),
];

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

/** The new key's spelling, in any code position: only `core/src/Integrity.ts` (which builds it from the prefix) owns it. */
const NEW_INTEGRITY_LITERAL = /x-okfit-integrity/;

/**
 * A profile field's new spelling in any code position (`x-okfit-kind`, `x-okfit-links-to`): only
 * `profiles/src/ProfileKeys.ts`, which builds it from the prefix, owns it. Prose that names a key
 * interpolates `ProfileKeys` instead.
 */
const NEW_FIELD_LITERAL = new RegExp(
	`x-okfit-(?:${[...DISTINCTIVE, ...COMMON].map((name) => name.replaceAll("_", "-")).join("|")})\\b`,
);

const PATTERNS: ReadonlyArray<RegExp> = [
	INTEGRITY_LITERAL,
	NEW_INTEGRITY_LITERAL,
	NEW_FIELD_LITERAL,
	...FIELD_PATTERNS,
];

/** Each pattern's first match per line of `source` with comments removed. */
const literalsIn = (source: string): ReadonlyArray<string> => hitsIn(source).map((hit) => hit.match);

interface Hit {
	readonly line: number;
	readonly text: string;
	readonly match: string;
}

const hitsIn = (source: string): ReadonlyArray<Hit> =>
	stripComments(source)
		.split("\n")
		.flatMap((text, index) =>
			PATTERNS.flatMap((pattern) => {
				const match = pattern.exec(text);
				return match === null ? [] : [{ line: index + 1, text, match: match[0] }];
			}),
		);

/**
 * A site that matches a pattern but is not a frontmatter key, scoped to a file and the line's text, with the
 * reason it is not one. Everything else that matches is a real key literal and fails the scan.
 */
interface Allowed {
	readonly file: string;
	readonly line: RegExp;
	readonly reason: string;
}
const NOT_A_KEY: ReadonlyArray<Allowed> = [
	{
		file: "packages/cli/src/render/verify.ts",
		line: /"entry" : "entries"/,
		reason: "display word for one removed verification",
	},
	{ file: "packages/core/src/Graph.ts", line: /_tag: "url"/, reason: "link-resolution tag" },
	{ file: "packages/core/src/internal/links.ts", line: /_tag: "url"/, reason: "link-classification tag" },
	{
		file: "packages/engine/src/validate/repository.ts",
		line: /^export type ResourceScope = /,
		reason: "ResourceScope member",
	},
	{
		file: "packages/engine/src/validate/repository.ts",
		line: /candidates\.push\(\{ absolute, scope: "repository" \}\)/,
		reason: "a ResourceScope value",
	},
	{ file: "packages/profiles/src/Canonical.ts", line: /\(renders: unknown\)/, reason: "a parameter name" },
	{
		file: "packages/profiles/src/SoftwareProject.ts",
		line: /directory: "runbooks"/,
		reason: "a layout directory, not a field",
	},
	{
		file: "packages/profiles/src/presets/surfaces.ts",
		line: /placeholder `url`/,
		reason: "prose in the preset body",
	},
];

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

	it("catches a literal x-okfit-integrity in code, not in a comment (positive control)", () => {
		expect(literalsIn('const k = "x-okfit-integrity";')).toEqual(["x-okfit-integrity"]);
		expect(literalsIn("const k = `x-okfit-integrity:\\n`;")).toEqual(["x-okfit-integrity"]);
		expect(literalsIn("// x-okfit-integrity\nconst k = 1;")).toEqual([]);
	});

	it("catches a literal x-okfit-<field> in code, kebab case included, not in a comment (positive control)", () => {
		expect(literalsIn('const k = "x-okfit-kind";')).toEqual(["x-okfit-kind"]);
		expect(literalsIn("const k = `point x-okfit-links-to at the Surface`;")).toEqual(["x-okfit-links-to"]);
		expect(literalsIn("const o = { [`x-okfit-renders`]: 1 };")).toEqual(["x-okfit-renders"]);
		expect(literalsIn("// x-okfit-kind\nconst k = 1;")).toEqual([]);
		expect(literalsIn("const k = ProfileKeys.kind;")).toEqual([]);
	});

	it("catches the integrity key line in each way it is rendered", () => {
		expect(literalsIn('const k = "integrity:\\n";')).toEqual(['"integrity:\\n']);
		const interpolation = "$" + "{";
		expect(literalsIn(`const k = \`integrity:${interpolation}nl}\`;`)).toEqual([`\`integrity:${interpolation}`]);
	});

	it("catches an unquoted key, a member read and a bracket read of a profile field", () => {
		expect(literalsIn("const o = { links_to: options.linksTo };")).toEqual(["links_to:"]);
		expect(literalsIn("const o = { ...(a ? {} : { links_to: b }) };")).toEqual(["links_to:"]);
		expect(literalsIn("const o = {\n\tlinks_to: b,\n\tother: 1,\n};")).toEqual(["links_to:"]);
		expect(literalsIn("const v = raw.renders;")).toEqual([".renders"]);
		expect(literalsIn('const v = raw["supersedes"];')).toEqual(['"supersedes"']);
		expect(literalsIn("const v = raw.surface;")).toEqual([".surface"]);
		expect(literalsIn("const w = { kind: 1, url: 2 }; const v = raw.kind;")).toEqual([]);
		expect(literalsIn("const v = ProfileKeys.renders;")).toEqual([]);
	});

	it("no source file outside the allowlist holds a quoted key literal, non-vacuously", () => {
		const files = sourceFiles();
		expect(files.length).toBeGreaterThan(100);
		for (const allowed of ALLOWED) {
			expect(files.map((file) => relative(ROOT, file))).toContain(allowed);
		}
		const offenders = files.flatMap((file) => {
			const name = relative(ROOT, file);
			if (ALLOWED.has(name)) return [];
			return hitsIn(readFileSync(file, "utf8"))
				.filter((hit) => !NOT_A_KEY.some((site) => site.file === name && site.line.test(hit.text)))
				.map((hit) => `${name}:${hit.line}: ${hit.text.trim()}`);
		});
		expect(offenders).toEqual([]);
	});

	it("every allowlisted site still matches a line, so a stale entry fails", () => {
		const stale = NOT_A_KEY.filter((site) => {
			const hits = hitsIn(readFileSync(join(ROOT, site.file), "utf8"));
			return !hits.some((hit) => site.line.test(hit.text));
		});
		expect(stale.map((site) => `${site.file} ${site.line}`)).toEqual([]);
	});
});
