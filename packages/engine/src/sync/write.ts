import { AtomicFile } from "@effected/files";
import type { FileSystem } from "effect";
import { Effect } from "effect";
import { detectNewline, stripBom } from "../verify/locate.js";

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
 * The leading UTF-8 BOM an existing file carries: `"\uFEFF"` when its first three bytes are `EF BB BF`, otherwise
 * `""`. A writer that edits a loader-read (BOM-stripped) text prepends this to what it writes, once, so a BOM that was
 * there is kept and one that was not is never added.
 *
 * @internal
 */
export const bomOf = (fs: FileSystem.FileSystem, absolutePath: string) =>
	fs
		.readFile(absolutePath)
		.pipe(
			Effect.map((bytes): "" | "\uFEFF" =>
				bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "\uFEFF" : "",
			),
		);

/**
 * {@link readSourceKeepingBom} for a file that may not exist yet: `text` is the content without its leading BOM
 * (`undefined` when the file is absent), `bom` the BOM that was stripped (`""` when none) and `newline` the file's
 * line ending (`detectNewline` of the text: its first newline's, LF for an absent or newline-free file), so a writer
 * can work in LF, compare with {@link withNewline}, and write `bom + withNewline(contents, newline)`.
 *
 * @internal
 */
export const readOptionalSplittingBom = (fs: FileSystem.FileSystem, target: string) =>
	readSourceKeepingBom(fs, target).pipe(
		Effect.map((raw): { readonly text: string | undefined; readonly bom: string; readonly newline: "\n" | "\r\n" } => {
			const { text, bom } = stripBom(raw);
			return { text, bom, newline: detectNewline(text) };
		}),
		Effect.catchReason("PlatformError", "NotFound", () =>
			Effect.succeed({ text: undefined, bom: "", newline: "\n" as "\n" | "\r\n" }),
		),
	);

/**
 * `text` (LF throughout, as the renderers produce it) in the given line ending. For CRLF every newline becomes CRLF;
 * text that already carries CRLF is not doubled. A sync rewrite uses the file's first newline throughout (#505), the
 * same rule verify uses.
 *
 * @internal
 */
export const withNewline = (text: string, newline: "\n" | "\r\n"): string =>
	newline === "\n" ? text : text.replace(/\r?\n/g, "\r\n");

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
