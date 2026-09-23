/**
 * Position and identity helpers navigation handlers share: LSP position to
 * text offset, the outgoing edge at an offset, and a concept's definition
 * location (decision 5 of the phase 4 plan).
 *
 * @packageDocumentation
 */
import type { GraphLink, LinkGraph, LoadedBundle, LoadedConcept } from "@okfit/core";
import { ConceptId, DiagnosticRange } from "@okfit/core";
import { conceptFor } from "@okfit/engine";
import { Option } from "effect";
import { toLspLocation } from "../convert/range.js";
import { pathToUri } from "../convert/uri.js";
import type { Location, Position } from "../protocol/types.js";

/** Drops every trailing `/` without a regex (a `/\/+$/` pattern is quadratic on a long run of slashes). */
const stripTrailingSlashes = (path: string): string => {
	let end = path.length;
	while (end > 0 && path.charCodeAt(end - 1) === 0x2f) end -= 1;
	return path.slice(0, end);
};

/**
 * Posix-normalizes `root` (backslashes to forward slashes, no trailing
 * slash) and joins `relative` onto it with one `/`. Mirrors the
 * normalisation the engine's own `session/concept.ts` applies to
 * `bundle.root`, since core's path helpers (`internal/posixPath.ts`) stay
 * internal. Shared with `features/navigation.ts`; not in the public barrel.
 *
 * @internal
 */
export const absolutePathOf = (root: string, relative: string): string => {
	const normalizedRoot = stripTrailingSlashes(root.split("\\").join("/"));
	return `${normalizedRoot}/${relative}`;
};

/**
 * The loaded concept at `absolutePath`, delegating to the engine's
 * `conceptFor` -- the one path-to-concept lookup every navigation handler
 * shares.
 *
 * @internal
 */
export const conceptAtPath = (bundle: LoadedBundle, absolutePath: string): Option.Option<LoadedConcept> =>
	conceptFor(bundle, absolutePath);

/**
 * `position` (LSP: zero-based line, UTF-16 character) as an offset into
 * `text`. Walks `text` line by line the way core's `lineCharacter` counts
 * them -- `\n`, `\r` and `\r\n` each count as one line break -- so this is
 * exactly the inverse of `DiagnosticRange.fromOffset`'s line/character
 * mapping. `position.character` is added as-is, in UTF-16 code units, which
 * is how a JavaScript string already indexes, so an astral character
 * earlier on the line needs no special handling. A character past the end
 * of its line clamps to that line's end, never the next line's start.
 *
 * @internal
 */
export const offsetOf = (text: string, position: Position): number => {
	let offset = 0;
	let line = 0;
	while (line < position.line && offset < text.length) {
		const code = text.charCodeAt(offset);
		if (code === 0x0d) {
			offset++;
			if (text.charCodeAt(offset) === 0x0a) offset++;
			line++;
		} else if (code === 0x0a) {
			offset++;
			line++;
		} else {
			offset++;
		}
	}
	// Clamp to the line's own end (its line break, or the end of text), as the LSP spec asks for a
	// character past the end of the line: never let it run on into the next line.
	const lineStart = offset;
	while (offset < text.length && offset - lineStart < position.character) {
		const code = text.charCodeAt(offset);
		if (code === 0x0d || code === 0x0a) break;
		offset++;
	}
	return offset;
};

/**
 * The edge, among every outgoing edge of the concept at `bundleRelativePath`,
 * whose recorded position contains `offset`; ties (an offset inside two
 * overlapping spans) are broken by the shorter span. `None` when
 * `bundleRelativePath` is not a concept id, the concept has no outgoing
 * edges, or none of them locate `offset`.
 *
 * @internal
 */
export const edgeAt = (graph: LinkGraph, bundleRelativePath: string, offset: number): Option.Option<GraphLink> => {
	const id = ConceptId.fromPath(bundleRelativePath);
	if (Option.isNone(id)) return Option.none();
	let best: GraphLink | undefined;
	let bestPosition: DiagnosticRange | undefined;
	for (const link of graph.edges) {
		if (link.from !== id.value) continue;
		const position = link.data.position;
		if (position === undefined) continue;
		if (offset < position.offset || offset >= position.offset + position.length) continue;
		if (bestPosition === undefined || position.length < bestPosition.length) {
			best = link;
			bestPosition = position;
		}
	}
	return best === undefined ? Option.none() : Option.some(best);
};

/**
 * `conceptId`'s definition location (decision 5 of the phase 4 plan): its
 * first depth-1 heading's range when it has one, else its frontmatter
 * block, else the file's very start (`0:0`). `None` when `conceptId` is not
 * loaded in `bundle`.
 *
 * @internal
 */
export const definitionOf = (bundle: LoadedBundle, conceptId: ConceptId): Option.Option<Location> => {
	const concept = bundle.concepts.get(conceptId);
	if (concept === undefined) return Option.none();
	const text = concept.document.source;
	const h1 = concept.document.findAll("heading").find((heading) => heading.depth === 1);
	const range =
		h1 !== undefined
			? DiagnosticRange.fromOffset(text, h1.position.start.offset, h1.position.end.offset - h1.position.start.offset)
			: (DiagnosticRange.forFrontmatterPath(concept.document, []) ??
				DiagnosticRange.make({ offset: 0, length: 0, line: 0, character: 0 }));
	const uri = pathToUri(absolutePathOf(bundle.root, ConceptId.toPath(conceptId)));
	return Option.some(toLspLocation(uri, text, range));
};
