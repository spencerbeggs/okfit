/**
 * `registerWorkspaceSymbols`: `workspace/symbol` over every live session's
 * last-loaded snapshot (decision 4 and decision 7 of the phase 4 plan --
 * answered from `session.bundle()` as last revalidated, never a trigger or a
 * wait).
 *
 * @packageDocumentation
 */
import type { ConceptId, LoadedBundle } from "@okfit/core";
import { Derive } from "@okfit/core";
import { Effect, Option } from "effect";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type { SymbolInformation, WorkspaceSymbolParams } from "../protocol/types.js";
import { SYMBOL_KIND_OBJECT } from "../protocol/types.js";
import type { SessionRegistryShape } from "../session/registry.js";
import { definitionOf } from "./locate.js";

/** Results are capped at this many entries (decision 7). */
const WORKSPACE_SYMBOL_LIMIT = 200;

/** Plain code-unit string order. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `id`/`title` compare case-insensitively against `query`, unless `query` is empty, which always matches. */
const matches = (query: string, id: ConceptId, title: string): boolean => {
	if (query === "") return true;
	const needle = query.toLowerCase();
	return id.toLowerCase().includes(needle) || title.toLowerCase().includes(needle);
};

/** One `[id, SymbolInformation]` pair per concept in `bundle` matching `query`, definition-location-bearing (decision 5). */
const symbolsOf = (bundle: LoadedBundle, query: string): ReadonlyArray<readonly [ConceptId, SymbolInformation]> => {
	const out: Array<readonly [ConceptId, SymbolInformation]> = [];
	for (const [id, concept] of bundle.concepts) {
		const title = Derive.title(concept);
		if (!matches(query, id, title)) continue;
		const location = definitionOf(bundle, id);
		if (Option.isNone(location)) continue;
		out.push([
			id,
			{ name: title, containerName: concept.frontmatter.type, kind: SYMBOL_KIND_OBJECT, location: location.value },
		]);
	}
	return out;
};

/**
 * Wires `workspace/symbol` onto `transport`, answering from every live
 * session's (`registry.sessions`) last-loaded bundle: case-insensitive
 * substring over id and title, an empty query matches every concept, capped
 * at 200 results (`WORKSPACE_SYMBOL_LIMIT`) sorted by id (decision 7), then by
 * URI. One symbol per definition URI: the same id in two bundles is two
 * symbols.
 *
 * @public
 */
export const registerWorkspaceSymbols = (
	transport: LspTransportShape,
	registry: SessionRegistryShape,
): Effect.Effect<void> =>
	transport.onRequest<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", (params) =>
		Effect.gen(function* () {
			const handles = yield* registry.sessions;
			const bundles = yield* Effect.forEach(handles, (handle) => handle.session.bundle());
			// Keyed by the definition's URI, not the bare id: two bundles can each carry the same id (every
			// software-project bundle has `project`), and those are two symbols. The registry holds one
			// session per bundle root, so the same concept never arrives twice.
			const byUri = new Map<string, readonly [ConceptId, SymbolInformation]>();
			for (const bundle of bundles) {
				if (Option.isNone(bundle)) continue;
				for (const entry of symbolsOf(bundle.value, params.query)) {
					const uri = entry[1].location.uri;
					if (!byUri.has(uri)) byUri.set(uri, entry);
				}
			}
			return [...byUri.values()]
				.sort(([a, x], [b, y]) => compare(a, b) || compare(x.location.uri, y.location.uri))
				.slice(0, WORKSPACE_SYMBOL_LIMIT)
				.map(([, symbol]) => symbol);
		}),
	);
