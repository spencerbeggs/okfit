import type { MarkdownDocument } from "@effected/markdown";
import type { Concept } from "../Concept.js";
import { basename, dirname, join, normalize } from "./posixPath.js";

/** Frontmatter fields whose value is a bundle path (D-23). @internal */
export type PathFieldName = "resource" | "sources.resource" | "computation" | "executor.resource" | "attester.resource";

/** Node kind a resolved target lands on (D-25). @internal */
export type ResolvedKind = "concept" | "file" | "missing";

/** One path-valued field as written. @internal */
export interface PathFieldRef {
	readonly field: PathFieldName;
	readonly raw: string;
}

/** Every walked file (posix, bundle-relative, with extension) and every loaded concept id. @internal */
export interface BundleIndex {
	readonly files: ReadonlySet<string>;
	readonly concepts: ReadonlySet<string>;
}

/** Outcome of resolving one raw target (D-23, D-24); only `node` yields an edge. @internal */
export type LinkResolution =
	| { readonly _tag: "url" }
	| { readonly _tag: "self" }
	| { readonly _tag: "external" }
	| { readonly _tag: "descriptor" }
	| { readonly _tag: "node"; readonly id: string; readonly kind: ResolvedKind };

/** A span in file text, zero-based UTF-16 offsets. @internal */
export interface TextSpan {
	readonly offset: number;
	readonly length: number;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i; // two-plus character scheme, so `C:` is not a URL

/** RFC 3986 scheme or `://` anywhere (D-24). @internal */
export const isUrl = (raw: string): boolean => raw.includes("://") || SCHEME_RE.test(raw);

const stripSuffixes = (raw: string): string => {
	const hash = raw.indexOf("#");
	const noFragment = hash < 0 ? raw : raw.slice(0, hash);
	const query = noFragment.indexOf("?");
	return query < 0 ? noFragment : noFragment.slice(0, query);
};

const percentDecode = (raw: string): string => {
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
};

const isReserved = (path: string): boolean => {
	const name = basename(path);
	return name === "index.md" || name === "log.md";
};

const escapes = (path: string): boolean => path === ".." || path.startsWith("../");

const withIndex = (candidate: string): string => (candidate.endsWith("/") ? `${candidate}index.md` : candidate);

const existing = (path: string, index: BundleIndex): LinkResolution | undefined => {
	if (!index.files.has(path)) return undefined;
	if (path.endsWith(".md") && !isReserved(path)) {
		const id = path.slice(0, -3);
		if (index.concepts.has(id)) return { _tag: "node", id, kind: "concept" };
	}
	return { _tag: "node", id: path, kind: "file" };
};

const lookup = (candidate: string, index: BundleIndex): LinkResolution | undefined => {
	const path = withIndex(candidate);
	if (path === "." || path === "") return undefined;
	const direct = existing(path, index);
	if (direct !== undefined) return direct;
	return basename(path).includes(".") ? undefined : existing(`${path}.md`, index);
};

const missing = (candidate: string): LinkResolution => ({ _tag: "node", id: withIndex(candidate), kind: "missing" });

/** Resolve a body link or path field from `from` (the linking file's bundle-relative path), order A-D (D-23). @internal */
export const resolveTarget = (from: string, raw: string, index: BundleIndex): LinkResolution => {
	const trimmed = raw.trim();
	if (isUrl(trimmed)) return { _tag: "url" };
	const target = percentDecode(stripSuffixes(trimmed));
	if (target === "") return { _tag: "self" };
	if (target.startsWith("/")) {
		const rooted = target.slice(1);
		const candidate = rooted === "" ? "index.md" : normalize(rooted);
		if (escapes(candidate)) return { _tag: "external" };
		return lookup(candidate, index) ?? missing(candidate);
	}
	const relative = target.startsWith("./") || target.startsWith("../");
	const fileRelative = join(dirname(from), target);
	if (escapes(fileRelative)) return { _tag: "external" };
	const hitB = lookup(fileRelative, index);
	if (hitB !== undefined) return hitB;
	if (!relative) {
		const rootRelative = normalize(target);
		if (escapes(rootRelative)) return { _tag: "external" };
		const hitC = lookup(rootRelative, index);
		if (hitC !== undefined) return hitC;
		if (target.includes("/")) return missing(rootRelative);
	}
	return missing(fileRelative);
};

/** Field-aware resolution (D-24): a `sources.resource` with whitespace, or that resolves to nothing, is a descriptor. @internal */
export const resolvePathField = (
	from: string,
	field: PathFieldName,
	raw: string,
	index: BundleIndex,
): LinkResolution => {
	if (field !== "sources.resource") return resolveTarget(from, raw, index);
	if (isUrl(raw.trim())) return { _tag: "url" };
	if (/\s/.test(raw.trim())) return { _tag: "descriptor" };
	const resolved = resolveTarget(from, raw, index);
	return resolved._tag === "node" && resolved.kind === "missing" ? { _tag: "descriptor" } : resolved;
};

/** The path-valued fields present on a concept, in frontmatter order. @internal */
export const pathFieldsOf = (concept: Concept): ReadonlyArray<PathFieldRef> => {
	const out: Array<PathFieldRef> = [];
	if (concept.resource !== undefined) out.push({ field: "resource", raw: concept.resource });
	for (const source of concept.sources ?? []) out.push({ field: "sources.resource", raw: source.resource });
	const attested = concept.attested;
	if (attested?.computation !== undefined) out.push({ field: "computation", raw: attested.computation });
	if (attested?.executor !== undefined) out.push({ field: "executor.resource", raw: attested.executor.resource });
	if (attested?.attester !== undefined) out.push({ field: "attester.resource", raw: attested.attester.resource });
	return out;
};

/** File span of the first occurrence of `raw` in the frontmatter block: `fenceLine.length + terminator.length + indexInValue`. @internal */
export const frontmatterFieldSpan = (document: MarkdownDocument, raw: string): TextSpan | undefined => {
	const node = document.frontmatter;
	if (node === undefined) return undefined;
	const at = node.value.indexOf(raw);
	if (at < 0) return undefined;
	const fence = node.format === "json" ? "---json" : node.format === "toml" ? "+++" : "---";
	const fenceEnd = node.position.start.offset + fence.length;
	const crlf = document.source.charCodeAt(fenceEnd) === 0x0d && document.source.charCodeAt(fenceEnd + 1) === 0x0a;
	return { offset: fenceEnd + (crlf ? 2 : 1) + at, length: raw.length };
};
