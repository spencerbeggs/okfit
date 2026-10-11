import { Timestamp } from "@okfit/core";
import type { ConceptSummary, QueryLink, QueryNeighbor, TrustDrift } from "@okfit/engine";
import { Schema } from "effect";

/**
 * One line per concept: `<id>  <status>  <trust>  <type>  <title>`. The trust
 * cell is `drifted` when the concept's human verification no longer binds,
 * otherwise its tier, with `,stale` appended once `stale_after` has passed.
 * `items` arrive
 * already sorted by id (`ConceptQuery.list`), so this never re-sorts.
 *
 * @public
 */
export const humanQueryList = (items: ReadonlyArray<ConceptSummary>): ReadonlyArray<string> =>
	items.map((item) => {
		const trust = `${item.integrity === "drifted" ? "drifted" : item.tier}${item.stale ? ",stale" : ""}`;
		return `${item.id}  ${item.status}  ${trust}  ${item.type}  ${item.title}`;
	});

const integrityLine = (summary: ConceptSummary, drift: TrustDrift | null): string => {
	if (summary.integrity !== "drifted") return `integrity: ${summary.integrity}`;
	if (drift === null) return "integrity: drifted";
	const edit =
		drift.edited_by === null || drift.edited_at === null ? "" : `; edited by ${drift.edited_by} at ${drift.edited_at}`;
	return `integrity: drifted (${drift.reason}${edit})`;
};

/**
 * `<N> concepts in <root>` (`1 concept` for one) — the one-line stderr summary.
 *
 * @public
 */
export const queryListSummary = (total: number, root: string): string =>
	`${total} ${total === 1 ? "concept" : "concepts"} in ${root}`;

/**
 * The bare id, then `key: value` lines, one `verified:` line per attestation,
 * then the outgoing links.
 *
 * @public
 */
export const humanQueryGet = (input: {
	readonly summary: ConceptSummary;
	readonly drift: TrustDrift | null;
	readonly verified: ReadonlyArray<{ readonly by: string; readonly at: typeof Timestamp.Type }>;
	readonly links: ReadonlyArray<QueryLink>;
}): ReadonlyArray<string> => {
	const { summary } = input;
	return [
		summary.id,
		`type: ${summary.type}`,
		`title: ${summary.title}`,
		`status: ${summary.status}`,
		`tier: ${summary.tier}`,
		integrityLine(summary, input.drift),
		`stale: ${summary.stale ? "yes" : "no"}`,
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
