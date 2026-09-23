/**
 * `registerNavigation`: `textDocument/documentLink`, `textDocument/definition`
 * and `textDocument/references` over the session's last-loaded snapshot
 * (decision 4 of the phase 4 plan -- no revalidate is ever triggered or
 * awaited here; every handler runs on the transport's request fiber, never
 * the notification queue, since a request answers whatever the last
 * revalidate produced).
 *
 * @packageDocumentation
 */
import type { ConceptId, LinkGraph, LoadedBundle } from "@okfit/core";
import { DiagnosticRange } from "@okfit/core";
import { Effect, Option } from "effect";
import { toLspRange } from "../convert/range.js";
import { pathToUri, uriToPath } from "../convert/uri.js";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type {
	DefinitionParams,
	DocumentLink,
	DocumentLinkParams,
	Location,
	ReferenceParams,
} from "../protocol/types.js";
import type { SessionRegistryShape } from "../session/registry.js";
import { absolutePathOf, conceptAtPath, definitionOf, edgeAt, offsetOf } from "./locate.js";

/** RFC 3986 scheme or `://` anywhere -- mirrors core's `internal/links.ts` `isUrl` exactly, kept in sync by hand since that helper is `@internal` and not in core's public barrel. */
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;
const isUrlLike = (raw: string): boolean => raw.includes("://") || URL_SCHEME_RE.test(raw);

interface OwnedSnapshot {
	readonly bundle: LoadedBundle;
	readonly graph: LinkGraph;
}

/** The owning session's last-loaded bundle and graph for `path`; `None` when there is no session or no revalidate has completed yet. */
const snapshotFor = (registry: SessionRegistryShape, path: string): Effect.Effect<Option.Option<OwnedSnapshot>> =>
	Effect.gen(function* () {
		const owner = yield* registry.sessionFor(path);
		if (Option.isNone(owner)) return Option.none();
		const bundle = yield* owner.value.session.bundle();
		const graph = yield* owner.value.session.graph();
		if (Option.isNone(bundle) || Option.isNone(graph)) return Option.none();
		return Option.some({ bundle: bundle.value, graph: graph.value });
	});

/** Every document link in the concept at `path`: graph edges to a `concept`/`file` target, plus raw body links whose URL is a URL (never a graph edge -- `Graph.fromBundle` drops URL, self, external and descriptor links before building edges). */
const documentLinksOf = (bundle: LoadedBundle, graph: LinkGraph, path: string): ReadonlyArray<DocumentLink> => {
	const concept = conceptAtPath(bundle, path);
	if (Option.isNone(concept)) return [];
	const { id, document } = concept.value;
	const text = document.source;
	const links: Array<{ readonly range: DiagnosticRange; readonly target: string }> = [];

	for (const edge of graph.edges) {
		if (edge.from !== id) continue;
		const position = edge.data.position;
		if (position === undefined) continue;
		const targetNode = graph.node(edge.to);
		if (Option.isNone(targetNode) || targetNode.value.kind === "missing") continue;
		const relative = targetNode.value.kind === "concept" ? `${targetNode.value.id}.md` : targetNode.value.id;
		links.push({ range: position, target: pathToUri(absolutePathOf(bundle.root, relative)) });
	}

	for (const link of document.links) {
		if (link.url === undefined || link.node.type === "linkReference" || link.node.type === "imageReference") continue;
		const trimmed = link.url.trim();
		if (!isUrlLike(trimmed)) continue;
		const { start, end } = link.node.position;
		links.push({
			range: DiagnosticRange.fromOffset(text, start.offset, end.offset - start.offset),
			target: link.url,
		});
	}

	return links.map(({ range, target }) => ({ range: toLspRange(text, range), target }));
};

/**
 * Wires `textDocument/documentLink`, `textDocument/definition` and
 * `textDocument/references` onto `transport`, each answering from
 * `registry`'s last-loaded snapshot: `registry.sessionFor(path)` then
 * `session.bundle()`/`session.graph()`. A missing session, an unloaded
 * bundle or graph, a non-`file:` URI, or a path outside every bundle root
 * all answer `null`/`[]` -- none of them ever schedules or waits on a
 * revalidate.
 *
 * @public
 */
export const registerNavigation = (transport: LspTransportShape, registry: SessionRegistryShape): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* transport.onRequest<DocumentLinkParams, ReadonlyArray<DocumentLink>>("textDocument/documentLink", (params) =>
			Effect.gen(function* () {
				const path = uriToPath(params.textDocument.uri);
				if (Option.isNone(path)) return [];
				const snapshot = yield* snapshotFor(registry, path.value);
				if (Option.isNone(snapshot)) return [];
				return documentLinksOf(snapshot.value.bundle, snapshot.value.graph, path.value);
			}),
		);

		yield* transport.onRequest<DefinitionParams, Location | null>("textDocument/definition", (params) =>
			Effect.gen(function* () {
				const path = uriToPath(params.textDocument.uri);
				if (Option.isNone(path)) return null;
				const snapshot = yield* snapshotFor(registry, path.value);
				if (Option.isNone(snapshot)) return null;
				const { bundle, graph } = snapshot.value;
				const concept = conceptAtPath(bundle, path.value);
				if (Option.isNone(concept)) return null;
				const text = concept.value.document.source;
				const offset = offsetOf(text, params.position);
				const edge = edgeAt(graph, concept.value.path, offset);
				if (Option.isNone(edge)) return null;
				const targetNode = graph.node(edge.value.to);
				if (Option.isNone(targetNode) || targetNode.value.kind === "missing") return null;
				if (targetNode.value.kind === "concept") {
					const location = definitionOf(bundle, targetNode.value.id as ConceptId);
					return Option.isNone(location) ? null : location.value;
				}
				const uri = pathToUri(absolutePathOf(bundle.root, targetNode.value.id));
				return { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
			}),
		);

		yield* transport.onRequest<ReferenceParams, ReadonlyArray<Location>>("textDocument/references", (params) =>
			Effect.gen(function* () {
				const path = uriToPath(params.textDocument.uri);
				if (Option.isNone(path)) return [];
				const snapshot = yield* snapshotFor(registry, path.value);
				if (Option.isNone(snapshot)) return [];
				const { bundle, graph } = snapshot.value;
				const concept = conceptAtPath(bundle, path.value);
				if (Option.isNone(concept)) return [];
				const id = concept.value.id;
				const locations: Array<Location> = [];
				for (const edge of graph.edges) {
					if (edge.to !== id || edge.from === edge.to) continue;
					const position = edge.data.position;
					if (position === undefined) continue;
					const referrer = bundle.concepts.get(edge.from as ConceptId);
					if (referrer === undefined) continue;
					locations.push({
						uri: pathToUri(absolutePathOf(bundle.root, `${edge.from}.md`)),
						range: toLspRange(referrer.document.source, position),
					});
				}
				if (params.context.includeDeclaration) {
					const declaration = definitionOf(bundle, id);
					if (Option.isSome(declaration)) locations.push(declaration.value);
				}
				return locations;
			}),
		);
	});
