import type { GraphNodeKind, LoadedBundle, LoadedConcept, OkfitConfig, Status } from "@okfit/core";
import { ConceptId, Derive, Graph } from "@okfit/core";
import { Effect, Option } from "effect";
import { QueryConceptNotFoundError, QueryUnknownVocabularyError } from "../errors.js";

/**
 * Filter for {@link ConceptQuery.list}. Every field is optional; an absent
 * field does not constrain.
 *
 * @public
 */
export interface ConceptFilter {
	/** OR across types. */
	readonly types?: ReadonlyArray<string>;
	/** AND: every tag must be present. */
	readonly tags?: ReadonlyArray<string>;
	/** OR, compared against `Derive.status` (an absent status reads as stable). */
	readonly statuses?: ReadonlyArray<Status>;
	/** `true`: at least one verified entry; `false`: none. */
	readonly verified?: boolean;
}

/** One outgoing link of a concept. @public */
export interface ConceptLink {
	readonly to: string;
	readonly kind: GraphNodeKind;
	readonly source: "body" | "frontmatter";
	readonly field?: string;
}

/** One graph neighbour; `concept` is `null` for a non-concept node (J-4). @public */
export interface ConceptNeighbor {
	readonly id: string;
	readonly kind: GraphNodeKind;
	readonly concept: LoadedConcept | null;
}

const byId = (a: LoadedConcept, b: LoadedConcept): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const resolve = (
	bundle: LoadedBundle,
	rawId: string,
): Effect.Effect<{ readonly id: ConceptId; readonly concept: LoadedConcept }, QueryConceptNotFoundError> =>
	Effect.gen(function* () {
		const normalized = ConceptId.normalize(rawId);
		if (Option.isNone(normalized)) {
			return yield* Effect.fail(new QueryConceptNotFoundError({ id: rawId, reason: "empty-id" }));
		}
		const id = normalized.value;
		const concept = bundle.concepts.get(id);
		if (concept === undefined) {
			return yield* Effect.fail(new QueryConceptNotFoundError({ id: rawId, reason: "not-a-concept" }));
		}
		return { id, concept };
	});

/**
 * Read-only queries over a loaded bundle, shared by `okfit query` and the MCP
 * tools.
 *
 * @public
 */
export const ConceptQuery = {
	/** Validates types then tags against config (first unknown fails), then filters and sorts by id. */
	list: (
		bundle: LoadedBundle,
		config: OkfitConfig,
		filter: ConceptFilter,
	): Effect.Effect<ReadonlyArray<LoadedConcept>, QueryUnknownVocabularyError> =>
		Effect.gen(function* () {
			const declaredTypes = Object.keys(config.types ?? {}).toSorted();
			const declaredTags = Object.keys(config.tags ?? {}).toSorted();
			const types = filter.types ?? [];
			for (const type of types) {
				if (!declaredTypes.includes(type)) {
					return yield* Effect.fail(
						new QueryUnknownVocabularyError({ kind: "type", requested: type, valid: declaredTypes }),
					);
				}
			}
			const requestedTags = filter.tags ?? [];
			for (const tag of requestedTags) {
				if (!declaredTags.includes(tag)) {
					return yield* Effect.fail(
						new QueryUnknownVocabularyError({ kind: "tag", requested: tag, valid: declaredTags }),
					);
				}
			}
			const statuses = filter.statuses ?? [];
			return (
				[...bundle.concepts.values()]
					.filter((concept) => {
						if (types.length > 0 && !types.includes(concept.frontmatter.type)) return false;
						const tags = concept.frontmatter.tags ?? [];
						if (!requestedTags.every((tag) => tags.includes(tag))) return false;
						if (statuses.length > 0 && !statuses.includes(Derive.status(concept.frontmatter))) return false;
						if (filter.verified !== undefined) {
							const hasVerified = (concept.frontmatter.verified ?? []).length > 0;
							if (hasVerified !== filter.verified) return false;
						}
						return true;
					})
					// Sort by id for a stable, deterministic order: ids are unique, so this
					// needs no secondary key, and a plain compare avoids locale-sensitive
					// collation across repeated calls.
					.toSorted(byId)
			);
		}),

	/** One concept by tolerant id, with its outgoing links. */
	get: (
		bundle: LoadedBundle,
		id: string,
	): Effect.Effect<
		{ readonly concept: LoadedConcept; readonly links: ReadonlyArray<ConceptLink> },
		QueryConceptNotFoundError
	> =>
		Effect.gen(function* () {
			const resolved = yield* resolve(bundle, id);
			// Read graph.edges rather than LinkGraph.successors: successors returns
			// unique target nodes only and drops the per-edge source/field this
			// result reports (J-23).
			const graph = Graph.fromBundle(bundle);
			const links = graph.edges
				.filter((edge) => edge.from === resolved.id)
				.map(
					(edge): ConceptLink => ({
						to: edge.to,
						kind: Option.match(graph.node(edge.to), { onNone: () => "missing" as const, onSome: (node) => node.kind }),
						source: edge.data.source,
						...(edge.data.field === undefined ? {} : { field: edge.data.field }),
					}),
				);
			return { concept: resolved.concept, links };
		}),

	/** Outgoing and incoming graph neighbours of one concept. */
	neighbors: (
		bundle: LoadedBundle,
		id: string,
	): Effect.Effect<
		{
			readonly id: string;
			readonly outgoing: ReadonlyArray<ConceptNeighbor>;
			readonly incoming: ReadonlyArray<ConceptNeighbor>;
		},
		QueryConceptNotFoundError
	> =>
		Effect.gen(function* () {
			const resolved = yield* resolve(bundle, id);
			// Here successors/predecessors are correct, unlike in get: this reports
			// unique neighbours only and needs no per-edge data (J-23). The concept
			// lookup above is repeated on purpose even though successors/
			// predecessors return [] for an unknown id: an unknown id is a caller
			// mistake, and an empty result would hide it.
			const graph = Graph.fromBundle(bundle);
			const project = (node: { readonly id: string; readonly kind: GraphNodeKind }): ConceptNeighbor => {
				if (node.kind !== "concept") return { id: node.id, kind: node.kind, concept: null };
				// A "concept"-kind node is by construction present in bundle.concepts;
				// emit null rather than throw if that invariant is ever violated (J-4).
				return { id: node.id, kind: node.kind, concept: bundle.concepts.get(node.id as ConceptId) ?? null };
			};
			return {
				id: resolved.id,
				outgoing: graph.successors(resolved.id).map(project),
				incoming: graph.predecessors(resolved.id).map(project),
			};
		}),
} as const;
