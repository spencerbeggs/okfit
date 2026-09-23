/**
 * `registerHover`: `textDocument/hover` over the session's last-loaded
 * snapshot (decision 4 of the phase 4 plan -- answered from
 * `session.bundle()`/`session.graph()` as last revalidated, never a trigger
 * or a wait). `now` is read once per request at the request boundary
 * (`DateTime.now`, decision 6) and passed into the pure renderer; nothing
 * downstream of this file reads a `Clock`.
 *
 * Three hover kinds (decision 6): an edge at the position (a body link or a
 * frontmatter path field) renders the target concept's title, type, status,
 * trust tier and staleness; the `type:` value renders that type's
 * description and guidance from the config vocabulary
 * (`OkfitConfig.types`); a top-level frontmatter key on its own line
 * (`^key:`, no leading whitespace) inside the frontmatter block, under a
 * known type, renders that field's description from
 * `OkfitConfig.types[type].fields[key]`. The field-key case is answered with
 * a line regex against the request's own line, not a second
 * `frontmatterPathRange`-style lookup: `DiagnosticRange.forFrontmatterPath`
 * locates a *value*'s span, and the key itself has no such helper, so a
 * one-line regex bounded by the frontmatter block's own range is cheaper
 * than teaching the core helper a key-locating mode for one caller. Anything
 * else answers `null`.
 *
 * @packageDocumentation
 */
import type { ConceptId, LinkGraph, LoadedBundle, LoadedConcept, OkfitConfig, TypeDeclaration } from "@okfit/core";
import { Derive, DiagnosticRange } from "@okfit/core";
import type { DateTime } from "effect";
import { DateTime as DateTimeService, Effect, Option } from "effect";
import { uriToPath } from "../convert/uri.js";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type { Hover, HoverParams, MarkupContent } from "../protocol/types.js";
import type { SessionRegistryShape } from "../session/registry.js";
import { conceptAtPath, edgeAt, offsetOf } from "./locate.js";

/** A bare identifier key opening a line, no leading whitespace: `key: ...` (top-level frontmatter field). */
const TOP_LEVEL_KEY_RE = /^([A-Za-z_][\w.-]*):/;

const markdown = (value: string): MarkupContent => ({ kind: "markdown", value });

/** The target concept's title, type, status, trust tier and staleness, as a markdown bullet list. */
const renderTargetHover = (concept: LoadedConcept, now: DateTime.Utc): string => {
	const title = Derive.title(concept);
	const type = concept.frontmatter.type;
	const status = Derive.status(concept.frontmatter);
	const tier = Derive.trustTier(concept.frontmatter);
	const staleness = Derive.staleness(concept.frontmatter, now);
	return [
		`**${title}**`,
		"",
		`- type: \`${type}\``,
		`- status: \`${status}\``,
		`- trust tier: \`${tier}\``,
		`- staleness: \`${staleness}\``,
	].join("\n");
};

/** A declared type's description and guidance from `config.types[typeName]`; `undefined` when it carries neither. */
const renderTypeHover = (typeName: string, declaration: typeof TypeDeclaration.Type): string | undefined => {
	const lines: Array<string> = [`**${typeName}**`];
	if (declaration.description !== undefined) lines.push("", declaration.description);
	if (declaration.guidance !== undefined) lines.push("", declaration.guidance);
	return lines.length === 1 ? undefined : lines.join("\n");
};

/** A declared extension field's own description from `config.types[typeName].fields[key]`. */
const renderFieldHover = (key: string, description: string): string => `**${key}**\n\n${description}`;

/**
 * Pure markdown renderer for the three hover kinds, tested directly. Exactly
 * one of `target`, `type` or `field` is set by the caller per request;
 * calling with none set renders `undefined` (no hover).
 *
 * @public
 */
export const renderHover = (input: {
	readonly target?: { readonly concept: LoadedConcept; readonly now: DateTime.Utc };
	readonly type?: { readonly name: string; readonly declaration: typeof TypeDeclaration.Type };
	readonly field?: { readonly key: string; readonly description: string };
}): string | undefined => {
	if (input.target !== undefined) return renderTargetHover(input.target.concept, input.target.now);
	if (input.type !== undefined) return renderTypeHover(input.type.name, input.type.declaration);
	if (input.field !== undefined) return renderFieldHover(input.field.key, input.field.description);
	return undefined;
};

interface Snapshot {
	readonly bundle: LoadedBundle;
	readonly graph: LinkGraph;
	readonly config: OkfitConfig;
}

/** The frontmatter key at `position` on its own top-level line, when `position` sits over the key name inside the frontmatter block. */
const fieldKeyAt = (concept: LoadedConcept, position: HoverParams["position"]): string | undefined => {
	const text = concept.document.source;
	const block = DiagnosticRange.forFrontmatterPath(concept.document, []);
	if (block === undefined) return undefined;
	const offset = offsetOf(text, position);
	if (offset < block.offset || offset >= block.offset + block.length) return undefined;
	const line = text.split("\n")[position.line];
	if (line === undefined) return undefined;
	const match = TOP_LEVEL_KEY_RE.exec(line);
	if (match === null) return undefined;
	const key = match[1] ?? "";
	return position.character >= 0 && position.character <= key.length ? key : undefined;
};

/** Whether `position` falls inside the `type` field's own value span. */
const onTypeValue = (concept: LoadedConcept, position: HoverParams["position"]): boolean => {
	const range = DiagnosticRange.forFrontmatterPath(concept.document, ["type"]);
	if (range === undefined) return false;
	const offset = offsetOf(concept.document.source, position);
	return offset >= range.offset && offset < range.offset + range.length;
};

/** The owning session's last-loaded bundle, graph and config for `path`; `None` when there is no session or no revalidate has completed yet. */
const snapshotFor = (registry: SessionRegistryShape, path: string): Effect.Effect<Option.Option<Snapshot>> =>
	Effect.gen(function* () {
		const owner = yield* registry.sessionFor(path);
		if (Option.isNone(owner)) return Option.none();
		const bundle = yield* owner.value.session.bundle();
		const graph = yield* owner.value.session.graph();
		if (Option.isNone(bundle) || Option.isNone(graph)) return Option.none();
		return Option.some({ bundle: bundle.value, graph: graph.value, config: owner.value.session.config() });
	});

/** `renderHover`'s markdown as a `Hover` response, or `null` when it renders nothing. */
const toHover = (value: string | undefined): Hover | null =>
	value === undefined ? null : { contents: markdown(value) };

/**
 * Wires `textDocument/hover` onto `transport`, answering from `registry`'s
 * last-loaded snapshot. A missing session, an unloaded bundle or graph, a
 * non-`file:` URI, or a path outside every bundle root all answer `null` --
 * never a hang. See the file header for the three hover kinds.
 *
 * @public
 */
export const registerHover = (transport: LspTransportShape, registry: SessionRegistryShape): Effect.Effect<void> =>
	transport.onRequest<HoverParams, Hover | null>("textDocument/hover", (params) =>
		Effect.gen(function* () {
			const path = uriToPath(params.textDocument.uri);
			if (Option.isNone(path)) return null;
			const snapshot = yield* snapshotFor(registry, path.value);
			if (Option.isNone(snapshot)) return null;
			const { bundle, graph, config } = snapshot.value;
			const concept = conceptAtPath(bundle, path.value);
			if (Option.isNone(concept)) return null;

			const text = concept.value.document.source;
			const offset = offsetOf(text, params.position);

			const edge = edgeAt(graph, concept.value.path, offset);
			if (Option.isSome(edge)) {
				const targetNode = graph.node(edge.value.to);
				if (Option.isNone(targetNode) || targetNode.value.kind !== "concept") return null;
				const targetConcept = bundle.concepts.get(targetNode.value.id as ConceptId);
				if (targetConcept === undefined) return null;
				const now = yield* DateTimeService.now;
				return toHover(renderHover({ target: { concept: targetConcept, now } }));
			}

			if (onTypeValue(concept.value, params.position)) {
				const typeName = concept.value.frontmatter.type;
				const declaration = config.types?.[typeName];
				if (declaration === undefined) return null;
				return toHover(renderHover({ type: { name: typeName, declaration } }));
			}

			const key = fieldKeyAt(concept.value, params.position);
			if (key !== undefined) {
				const typeName = concept.value.frontmatter.type;
				const description = config.types?.[typeName]?.fields?.[key]?.description;
				if (description === undefined) return null;
				return toHover(renderHover({ field: { key, description } }));
			}

			return null;
		}),
	);
