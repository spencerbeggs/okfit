import type { Document } from "@effected/cli";
import { Doc } from "@effected/cli";
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
 * The `Doc` form of {@link humanStale}: the same line per item, with the id a
 * link to its concept file (`<root>/<id>.md`) when `root`, the absolute bundle
 * root, is given. Plain output is byte-identical to `humanStale(items).join("\n")`.
 *
 * @public
 */
export const humanStaleDoc = (items: ReadonlyArray<StaleItem>, options?: { readonly root?: string }): Document =>
	items.map((item) =>
		Doc.line(
			[
				Doc.link(options?.root === undefined ? undefined : { file: `${options.root}/${item.id}.md` }, item.id, {
					suffix: false,
				}),
				`  ${item.stale_after}  (${item.days_past} days past)`,
			],
			{ wrap: false },
		),
	);

/**
 * `<N> stale concepts of <M> in <root>` — the one-line stderr summary.
 *
 * @public
 */
export const staleSummary = (stale: number, concepts: number, root: string): string =>
	`${stale} stale concepts of ${concepts} in ${root}`;
