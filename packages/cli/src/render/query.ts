import { Timestamp } from "@okfit/core";
import type { ConceptSummary, QueryLink, QueryNeighbor } from "@okfit/engine";
import { Schema } from "effect";

/**
 * One line per concept: `<id>  <status>  <type>  <title>`. `items` arrive
 * already sorted by id (`ConceptQuery.list`), so this never re-sorts.
 *
 * @public
 */
export const humanQueryList = (items: ReadonlyArray<ConceptSummary>): ReadonlyArray<string> =>
	items.map((item) => `${item.id}  ${item.status}  ${item.type}  ${item.title}`);

/**
 * `<N> concepts in <root>` — the one-line stderr summary.
 *
 * @public
 */
export const queryListSummary = (total: number, root: string): string => `${total} concepts in ${root}`;

/**
 * The bare id, then `key: value` lines, one `verified:` line per attestation,
 * then the outgoing links.
 *
 * @public
 */
export const humanQueryGet = (input: {
	readonly summary: ConceptSummary;
	readonly verified: ReadonlyArray<{ readonly by: string; readonly at: typeof Timestamp.Type }>;
	readonly links: ReadonlyArray<QueryLink>;
}): ReadonlyArray<string> => {
	const { summary } = input;
	return [
		summary.id,
		`type: ${summary.type}`,
		`title: ${summary.title}`,
		`status: ${summary.status}`,
		`tags: ${summary.tags.length === 0 ? "(none)" : summary.tags.join(", ")}`,
		`path: ${summary.path}`,
		...input.verified.map((entry) => `verified: ${entry.by} at ${Schema.encodeSync(Timestamp)(entry.at)}`),
		"links:",
		...(input.links.length === 0
			? ["  (none)"]
			: input.links.map((link) => {
					const detail = [link.kind, link.source, ...(link.field === undefined ? [] : [link.field])].join(", ");
					return `  -> ${link.to} (${detail})`;
				})),
	];
};

/**
 * `outgoing:` then `incoming:`, each a list of `->`/`<-` lines or `(none)`.
 *
 * @public
 */
export const humanQueryNeighbors = (input: {
	readonly outgoing: ReadonlyArray<QueryNeighbor>;
	readonly incoming: ReadonlyArray<QueryNeighbor>;
}): ReadonlyArray<string> => [
	"outgoing:",
	...(input.outgoing.length === 0 ? ["  (none)"] : input.outgoing.map((n) => `  -> ${n.id} (${n.kind})`)),
	"incoming:",
	...(input.incoming.length === 0 ? ["  (none)"] : input.incoming.map((n) => `  <- ${n.id} (${n.kind})`)),
];
