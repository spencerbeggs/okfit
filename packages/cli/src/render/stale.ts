import type { Document } from "@effected/cli-kit";
import { Doc } from "@effected/cli-kit";
import type { MalformedStaleItem, StaleItem } from "@okfit/engine";

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
 * `<N> stale concepts of <M> in <root>` — the one-line stderr summary, with `, <K> malformed` appended when
 * `malformed` (the count of unreadable `stale_after` values) is above zero.
 *
 * @public
 */
export const staleSummary = (stale: number, concepts: number, root: string, malformed = 0): string =>
	`${stale} stale concepts of ${concepts} in ${root}${malformed > 0 ? `, ${malformed} malformed` : ""}`;

/**
 * The malformed block (OKF 0.3 section 5.5): a `malformed stale_after:` heading, then one
 * `<id>  <raw>` line per concept whose `stale_after` cannot be read. Empty when there are none.
 *
 * @public
 */
export const humanMalformed = (items: ReadonlyArray<MalformedStaleItem>): ReadonlyArray<string> =>
	items.length === 0 ? [] : ["malformed stale_after:", ...items.map((item) => `${item.id}  ${item.stale_after}`)];
