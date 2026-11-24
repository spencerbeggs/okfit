import { AtomicFile } from "@effected/files";
import type { FileSystem } from "effect";
import { Effect } from "effect";

/**
 * S-33: the one atomic write every sync mode shares, over the kit's
 * `AtomicFile.write`. A symlinked `index.md`/`log.md`/concept file is written
 * through its link, an existing file keeps its mode, a file `sync` creates for
 * the first time is simply created, and a failure at any step leaves the
 * target untouched with no temp file behind. A target without write permission
 * is refused rather than replaced.
 *
 * @internal
 */
export const writeAtomic = Effect.fn("okfit/sync/writeAtomic")(function* (target: string, contents: string) {
	yield* AtomicFile.write(target, contents);
});

/**
 * Read a concept file as text with a leading UTF-8 BOM kept. `readFileString` decodes with a BOM-stripping
 * `TextDecoder`, so a writer that re-prepends `stripBom(...).bom` would otherwise always see an empty one and
 * drop the BOM on write-back.
 *
 * @internal
 */
export const readSourceKeepingBom = (fs: FileSystem.FileSystem, target: string) =>
	fs.readFile(target).pipe(Effect.map((bytes) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)));

/**
 * A write a sync mode would perform: the plan half of plan/apply. `target` is
 * the absolute path handed to `writeAtomic`; `contents` the full text. `before`
 * is what `planSync` read from `target` while planning (`null` = the file was
 * absent); `applySyncPlan` refuses to run when a target no longer matches it.
 * A write without `before` is applied unchecked.
 *
 * @public
 */
export interface PendingWrite {
	readonly target: string;
	readonly contents: string;
	readonly before?: string | null;
}
