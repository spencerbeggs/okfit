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
	/** The decoded value: what the located text must spell for the reference to be rewritable. */
	readonly value: string;
	readonly field?: PathField;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The frontmatter paths whose values are bundle paths, for this concept. */
const fieldPaths = (concept: LoadedConcept, config: OkfitConfig): ReadonlyArray<FieldPath> => {
	const raw = concept.frontmatter.raw;
	const out: Array<FieldPath> = [];
	if (typeof raw.resource === "string") out.push({ path: ["resource"], value: raw.resource, field: "resource" });
	if (Array.isArray(raw.sources)) {
		raw.sources.forEach((entry, i) => {
			if (isRecord(entry) && typeof entry.resource === "string")
				out.push({ path: ["sources", i, "resource"], value: entry.resource, field: "sources.resource" });
		});
	}
	const attested = raw.attested;
	if (isRecord(attested)) {
		if (typeof attested.computation === "string")
			out.push({ path: ["attested", "computation"], value: attested.computation, field: "computation" });
		const executor = attested.executor;
		if (isRecord(executor) && typeof executor.resource === "string")
			out.push({ path: ["attested", "executor", "resource"], value: executor.resource, field: "executor.resource" });
		const attester = attested.attester;
		if (isRecord(attester) && typeof attester.resource === "string")
			out.push({ path: ["attested", "attester", "resource"], value: attester.resource, field: "attester.resource" });
	}
	const declared = config.types?.[concept.frontmatter.type]?.fields ?? {};
	for (const [key, declaration] of Object.entries(declared)) {
		if (declaration.kind !== "path" || key === "resource") continue;
		const value = raw[key];
		if (typeof value === "string") out.push({ path: [key], value });
		else if (Array.isArray(value)) {
			value.forEach((item, i) => {
				if (typeof item === "string") out.push({ path: [key, i], value: item });
			});
		}
	}
	if (Array.isArray(raw.renders)) {
		raw.renders.forEach((entry, i) => {
			if (isRecord(entry) && typeof entry.path === "string")
				out.push({ path: ["renders", i, "path"], value: entry.path });
		});
	}
	return out;
};

const DESTINATION_AFTER = new Set([")", ">", " ", "\t", "\n"]);

/**
 * The destination of a link, image or definition inside its node's source slice: the first
 * occurrence of `url` right after `](` / `](<` (inline) or after `]:` and whitespace (definition),
 * never the link text or a title.
 */
const locateDestination = (slice: string, url: string, type: "link" | "image" | "definition"): number => {
	const opener = type === "definition" ? /\]:[ \t]*\n?[ \t]*<?/y : /\]\([ \t]*\n?[ \t]*<?/y;
	for (let at = slice.indexOf(url); at >= 0; at = slice.indexOf(url, at + 1)) {
		const after = at + url.length >= slice.length ? " " : (slice[at + url.length] as string);
		if (!DESTINATION_AFTER.has(after)) continue;
		// Does an opener end exactly at `at`? Try each opener start before it.
		for (let start = at - 1; start >= 0 && at - start <= 16; start--) {
			if (slice[start] !== "]") continue;
			opener.lastIndex = start;
			const match = opener.exec(slice);
			if (match !== null && start + match[0].length === at) return at;
		}
	}
	return -1;
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
		const at = locateDestination(slice, link.url, type);
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
	for (const { path, value, field } of fieldPaths(concept, config)) {
		if (value.trim() === "") continue;
		const range = DiagnosticRange.forFrontmatterPath(concept.document, path);
		const text = range === undefined ? "" : source.slice(range.offset, range.offset + range.length);
		const first = text[0];
		const quoted = text.length >= 2 && (first === '"' || first === "'") && text.at(-1) === first;
		const raw = quoted ? text.slice(1, -1) : text;
		if (range === undefined || raw !== value) {
			unlocatable.push(`${concept.path}: ${value}`);
			continue;
		}
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

const afterMove = new WeakMap<LoadedBundle, Map<string, LoadedBundle>>();

/** The bundle as it will be once `movedFrom` has become `movedTo`: only its file and concept sets matter. */
const bundleAfterMove = (bundle: LoadedBundle, movedFrom: string, movedTo: string): LoadedBundle => {
	const cached = afterMove.get(bundle)?.get(`${movedFrom}\0${movedTo}`);
	if (cached !== undefined) return cached;
	const fromId = movedFrom.slice(0, -3);
	const concepts = new Map(bundle.concepts);
	const moved = concepts.get(fromId as never);
	concepts.delete(fromId as never);
	if (moved !== undefined) concepts.set(movedTo.slice(0, -3) as never, moved);
	const files = [...bundle.files.filter((file) => file !== movedFrom), movedTo];
	const next = { ...bundle, files, concepts } as LoadedBundle;
	const byMove = afterMove.get(bundle) ?? new Map<string, LoadedBundle>();
	byMove.set(`${movedFrom}\0${movedTo}`, next);
	afterMove.set(bundle, byMove);
	return next;
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
	if (via === "file" && !moved && options.fromNew === options.fromOld) return undefined;
	if (via === "rooted" && !moved) return undefined;
	const keepMd = pathPart.endsWith(".md");
	const directory = pathPart.endsWith("/");
	const stripped = (path: string) =>
		directory ? `${posix.dirname(path) === "." ? "" : posix.dirname(path)}/` : stripMd(path, keepMd);
	let written: string;
	if (via === "rooted") {
		written = `/${stripped(next)}`;
	} else if (via === "root") {
		// A bare reference resolves file-relative first (D-23 B): if the post-move location would
		// retarget it, spell it rooted instead.
		const after = bundleAfterMove(options.bundle, options.movedFrom, options.movedTo);
		const bare = stripped(next);
		const lands = (text: string): boolean => {
			const again = Graph.resolve(after, options.fromNew, `${text}${suffix}`, options.field);
			return (
				again._tag === "node" &&
				again.kind !== "missing" &&
				(again.kind === "concept" ? `${again.id}.md` : again.id) === next
			);
		};
		written = lands(bare) ? bare : `/${bare}`;
	} else {
		const base = directory ? posix.dirname(next) : next;
		let relative = relativeTo(posix.dirname(options.fromNew), base);
		if (directory) relative = `${relative === "" ? "." : relative}/`;
		if (pathPart.startsWith("./") && !relative.startsWith(".")) relative = `./${relative}`;
		written = directory ? relative : stripMd(relative, keepMd);
	}
	return written === pathPart ? undefined : `${written}${suffix}`;
};
