import { YamlFrontmatter } from "@effected/markdown";
import type { LoadedBundle } from "@okfit/core";
import { Bundle, ConceptId } from "@okfit/core";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result } from "effect";
import type { ReferenceSource } from "./references.js";

/**
 * The Markdown a bundle holds that did not load as a concept, ready to scan for references.
 *
 * @public
 */
export interface MarkdownSources {
	/** Every scannable non-concept file, each with `frontmatter.type` unset; reserved files carry `raw: {}`. */
	readonly sources: ReadonlyArray<ReferenceSource>;
	/** Bundle-relative paths of `.md` files that could not be read (unclosed or unparseable frontmatter), sorted. */
	readonly unreadable: ReadonlyArray<string>;
}

/**
 * Read the Markdown of `bundle` that is not a loaded concept. A file the loader skipped as frontmatter-less or
 * typeless (OKF 0.3 3.2: simply not a concept) is a source scanned like a concept body; one it could not read
 * (unclosed or unparseable frontmatter, or no diagnostic saying why) is listed in `unreadable` instead. With
 * `reserved: true` every `index.md` and `log.md` the loader read is a source too, its frontmatter passed as `raw: {}`
 * so index metadata is never read as a path field; a reserved file the loader could not read is `unreadable`. A
 * symbolic link that escapes the bundle is not in `bundle.files`, so it is neither.
 *
 * @public
 */
export const readMarkdownSources = Effect.fn("okfit/move/sources")(function* (
	bundle: LoadedBundle,
	options: { readonly reserved: boolean },
): Effect.fn.Return<MarkdownSources, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const codesByFile = new Map<string, Set<string>>();
	for (const { file, code } of bundle.diagnostics) {
		const codes = codesByFile.get(file) ?? new Set<string>();
		codes.add(code);
		codesByFile.set(file, codes);
	}
	const sources: Array<ReferenceSource> = [];
	const unreadable: Array<string> = [];
	const dirOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
	for (const file of bundle.files) {
		if (!file.endsWith(".md")) continue;
		const reserved = ConceptId.isReservedFile(file);
		if (reserved && !options.reserved) continue;
		if (!reserved && bundle.concepts.has(file.slice(0, -3) as never)) continue;
		if (reserved) {
			const loaded = file.endsWith("log.md") ? bundle.logs.has(dirOf(file)) : bundle.indexes.has(dirOf(file));
			if (!loaded) {
				unreadable.push(file);
				continue;
			}
		} else {
			// An unclosed or unparseable block records only its own error, never one of the two skip warnings.
			const codes = codesByFile.get(file);
			if (codes === undefined || !(codes.has("frontmatter-missing") || codes.has("type-missing"))) {
				unreadable.push(file);
				continue;
			}
		}
		const text = yield* fs.readFileString(path.join(bundle.root, file));
		const parsed = Bundle.parseDocument(text);
		if (!Result.isSuccess(parsed)) {
			unreadable.push(file);
			continue;
		}
		if (reserved) {
			sources.push({ path: file, document: parsed.success, frontmatter: { raw: {} } });
			continue;
		}
		const node = Option.getOrUndefined(parsed.success.frontmatter);
		let raw: Record<string, unknown> = {};
		if (node !== undefined) {
			const read = yield* Effect.result(YamlFrontmatter.decode(node));
			if (Result.isFailure(read)) {
				unreadable.push(file);
				continue;
			}
			// An empty block decodes to null: core reports it `type-missing`, a non-concept with no fields.
			if (read.success !== null && read.success !== undefined) {
				if (typeof read.success !== "object" || Array.isArray(read.success)) {
					unreadable.push(file);
					continue;
				}
				raw = read.success as Record<string, unknown>;
			}
		}
		sources.push({ path: file, document: parsed.success, frontmatter: { raw } });
	}
	return { sources, unreadable: unreadable.toSorted() };
});
