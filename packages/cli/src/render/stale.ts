import type { StaleItem } from "@okfit/engine";

/**
 * One line per stale concept: `<id>  <stale_after ISO>  (<N> days past)`.
 * `items` is `StaleEnvelope`'s own `items` array — already sorted by id
 * (`Derive.staleReport`) — so this renderer never re-sorts.
 *
 * @public
 */
export const humanStale = (items: ReadonlyArray<StaleItem>): ReadonlyArray<string> =>
	items.map((item) => `${item.id}  ${item.stale_after}  (${item.days_past} days past)`);

/**
 * `<N> stale concepts of <M> in <root>` — the one-line stderr summary.
 *
 * @public
 */
export const staleSummary = (stale: number, concepts: number, root: string): string =>
	`${stale} stale concepts of ${concepts} in ${root}`;
