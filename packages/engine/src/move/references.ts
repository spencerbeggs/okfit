import { posix } from "node:path";
import type { LoadedBundle, LoadedConcept, OkfitConfig, PathField } from "@okfit/core";
import { DiagnosticRange, Graph } from "@okfit/core";

/**
 * One reference's value text inside a file: whole-file offsets, quotes excluded. `field` is set for
 * the frontmatter fields core resolves with path-field rules (`resource`, `sources.resource`, ...).
 *
 * @public
 */
export interface Reference {
	readonly file: string;
	readonly offset: number;
	readonly length: number;
	readonly raw: string;
	readonly quote: "" | "'" | '"';
	readonly field?: PathField;
}

const SCHEME = /^[a-z][a-z0-9+.-]+:/i;
const isUrl = (raw: string): boolean => raw.includes("://") || SCHEME.test(raw);
const splitSuffix = (raw: string): readonly [string, string] => {
	const at = raw.search(/[?#]/);
	return at < 0 ? [raw, ""] : [raw.slice(0, at), raw.slice(at)];
};

type Segment = string | number;
interface FieldPath {
	readonly path: ReadonlyArray<Segment>;
	readonly field?: PathField;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The frontmatter paths whose values are bundle paths, for this concept. */
const fieldPaths = (concept: LoadedConcept, config: OkfitConfig): ReadonlyArray<FieldPath> => {
	const raw = concept.frontmatter.raw;
	const out: Array<FieldPath> = [];
	if (typeof raw.resource === "string") out.push({ path: ["resource"], field: "resource" });
	if (Array.isArray(raw.sources)) {
		raw.sources.forEach((entry, i) => {
			if (isRecord(entry) && typeof entry.resource === "string")
				out.push({ path: ["sources", i, "resource"], field: "sources.resource" });
		});
	}
	const attested = raw.attested;
	if (isRecord(attested)) {
		if (typeof attested.computation === "string") out.push({ path: ["attested", "computation"], field: "computation" });
		const executor = attested.executor;
		if (isRecord(executor) && typeof executor.resource === "string")
			out.push({ path: ["attested", "executor", "resource"], field: "executor.resource" });
		const attester = attested.attester;
		if (isRecord(attester) && typeof attester.resource === "string")
			out.push({ path: ["attested", "attester", "resource"], field: "attester.resource" });
	}
	const declared = config.types?.[concept.frontmatter.type]?.fields ?? {};
	for (const [key, declaration] of Object.entries(declared)) {
		if (declaration.kind !== "path" || key === "resource") continue;
		const value = raw[key];
		if (typeof value === "string") out.push({ path: [key] });
		else if (Array.isArray(value)) {
			value.forEach((item, i) => {
				if (typeof item === "string") out.push({ path: [key, i] });
			});
		}
	}
	if (Array.isArray(raw.renders)) {
		raw.renders.forEach((entry, i) => {
			if (isRecord(entry) && typeof entry.path === "string") out.push({ path: ["renders", i, "path"] });
		});
	}
	return out;
};

const DESTINATION_BEFORE = new Set(["(", "<", " ", "\t", "\n"]);
const DESTINATION_AFTER = new Set([")", ">", " ", "\t", "\n"]);

/** The last occurrence of `url` in `slice` that stands where a destination does (not the link text or title). */
const locateDestination = (slice: string, url: string): number => {
	let found = -1;
	for (let at = slice.indexOf(url); at >= 0; at = slice.indexOf(url, at + 1)) {
		const before = at === 0 ? " " : (slice[at - 1] as string);
		const after = at + url.length >= slice.length ? " " : (slice[at + url.length] as string);
		if (DESTINATION_BEFORE.has(before) && DESTINATION_AFTER.has(after)) found = at;
	}
	return found;
};

/**
 * Every rewritable reference in a concept, plus the body URLs that could not be located in their node
 * (`file: url`). Body links, images and definitions with a URL; the path-valued frontmatter fields;
 * every field the concept's type declares with `kind = "path"`; and `renders[].path`.
 *
 * @public
 */
export const referencesOf = (
	concept: LoadedConcept,
	config: OkfitConfig,
): { readonly references: ReadonlyArray<Reference>; readonly unlocatable: ReadonlyArray<string> } => {
	const source = concept.document.source;
	const references: Array<Reference> = [];
	const unlocatable: Array<string> = [];
	for (const link of concept.document.links) {
		const type = link.node.type;
		if (link.url === undefined || (type !== "link" && type !== "image" && type !== "definition")) continue;
		const { start, end } = link.node.position;
		const slice = source.slice(start.offset, end.offset);
		const at = locateDestination(slice, link.url);
		if (at < 0) {
			unlocatable.push(`${concept.path}: ${link.url}`);
			continue;
		}
		references.push({
			file: concept.path,
			offset: start.offset + at,
			length: link.url.length,
			raw: link.url,
			quote: "",
		});
	}
	for (const { path, field } of fieldPaths(concept, config)) {
		const range = DiagnosticRange.forFrontmatterPath(concept.document, path);
		if (range === undefined) continue;
		const text = source.slice(range.offset, range.offset + range.length);
		const first = text[0];
		const quoted = text.length >= 2 && (first === '"' || first === "'") && text.at(-1) === first;
		const raw = quoted ? text.slice(1, -1) : text;
		if (raw === "" || /[\n\r]/.test(raw)) continue;
		references.push({
			file: concept.path,
			offset: range.offset + (quoted ? 1 : 0),
			length: raw.length,
			raw,
			quote: quoted ? (first as "'" | '"') : "",
			...(field === undefined ? {} : { field }),
		});
	}
	return { references, unlocatable };
};

const stripMd = (path: string, keep: boolean): string => (keep || !path.endsWith(".md") ? path : path.slice(0, -3));

/** `to` relative to the bundle-relative directory `fromDir`, where `to` may itself climb out (`../x`). */
const relativeTo = (fromDir: string, to: string): string => {
	const from = fromDir === "." || fromDir === "" ? [] : fromDir.split("/");
	const target = to.split("/");
	if (target[0] === "..") return `${"../".repeat(from.length)}${to}`;
	let shared = 0;
	while (shared < from.length && shared < target.length - 1 && from[shared] === target[shared]) shared++;
	return [...Array.from({ length: from.length - shared }, () => ".."), ...target.slice(shared)].join("/");
};

/**
 * The new text for one reference after `movedFrom` (a bundle-relative `.md` path) moves to `movedTo`,
 * or `undefined` when the text stays as written. The reference was written in `fromOld`, which is
 * now at `fromNew` (equal unless the file itself is the one that moved). The spelling is kept: a
 * rooted reference stays rooted, a bare one stays bare, `./`, a dropped `.md`, a `#fragment`/`?query`
 * suffix and a trailing `/` survive.
 *
 * @public
 */
export const rewriteReference = (
	raw: string,
	options: {
		readonly bundle: LoadedBundle;
		readonly fromOld: string;
		readonly fromNew: string;
		readonly movedFrom: string;
		readonly movedTo: string;
		readonly field?: PathField;
	},
): string | undefined => {
	const trimmed = raw.trim();
	if (trimmed === "" || isUrl(trimmed) || /\s/.test(trimmed)) return undefined;
	const [pathPart, suffix] = splitSuffix(trimmed);
	if (pathPart === "") return undefined;
	const resolved = Graph.resolve(options.bundle, options.fromOld, trimmed, options.field);
	const explicit = pathPart.startsWith("./") || pathPart.startsWith("../");
	let target: string;
	let via: "rooted" | "file" | "root";
	if (resolved._tag === "node") {
		if (resolved.kind === "missing") return undefined;
		target = resolved.kind === "concept" ? `${resolved.id}.md` : resolved.id;
		via = resolved.via;
	} else if (resolved._tag === "external" && explicit) {
		target = posix.join(posix.dirname(options.fromOld), pathPart);
		via = "file";
	} else return undefined;
	const moved = target === options.movedFrom;
	const next = moved ? options.movedTo : target;
	if (!moved && options.fromNew === options.fromOld) return undefined;
	const keepMd = pathPart.endsWith(".md");
	const directory = pathPart.endsWith("/");
	let written: string;
	if (via === "rooted" || via === "root") {
		if (!moved) return undefined;
		written = `${via === "rooted" ? "/" : ""}${stripMd(next, keepMd)}`;
	} else {
		const base = directory ? posix.dirname(next) : next;
		let relative = relativeTo(posix.dirname(options.fromNew), base);
		if (directory) relative = `${relative === "" ? "." : relative}/`;
		if (pathPart.startsWith("./") && !relative.startsWith(".")) relative = `./${relative}`;
		written = directory ? relative : stripMd(relative, keepMd);
	}
	return written === pathPart ? undefined : `${written}${suffix}`;
};
