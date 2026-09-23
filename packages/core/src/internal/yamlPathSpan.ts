import type { Frontmatter } from "@effected/markdown";
import type { YamlParseError, YamlPath } from "@effected/yaml";
import { YamlDocument } from "@effected/yaml";
import { Effect, Option, Result } from "effect";
import { toFileOffset } from "./position.js";

/**
 * A raw offset/length span inside a file's text, with no line/character shift applied yet
 * (that belongs to `DiagnosticRange.fromOffset`, which lives in `Diagnostic.ts`). Kept
 * dependency-free of `Diagnostic.ts` so `internal/frontmatter.ts` (which already depends on
 * `Diagnostic.ts` for `DiagnosticRange`) and `Diagnostic.ts` itself (for the public
 * `DiagnosticRange.forFrontmatterPath` static) can both build on this without an import cycle.
 *
 * @internal
 */
export interface OffsetSpan {
	readonly offset: number;
	readonly length: number;
}

const blockSpan = (node: Frontmatter): OffsetSpan => ({
	offset: node.position.start.offset,
	length: node.position.end.offset - node.position.start.offset,
});

/**
 * One concept's frontmatter is re-parsed at most once per process, keyed by the `Frontmatter`
 * node's own identity (stable for the lifetime of a loaded document): a lint pass fires several
 * rules per concept (`unknown-type`, `stale`, `actor-prefix-unknown`, ...), and each one that
 * anchors a range would otherwise re-run this YAML parse over the same, unchanged text.
 */
const parsedCache = new WeakMap<Frontmatter, Result.Result<YamlDocument, YamlParseError>>();

const parsedYamlOf = (node: Frontmatter): Result.Result<YamlDocument, YamlParseError> => {
	const cached = parsedCache.get(node);
	if (cached !== undefined) return cached;
	const parsed = Effect.runSync(Effect.result(YamlDocument.parse(node.value)));
	parsedCache.set(node, parsed);
	return parsed;
};

/**
 * Lazily parses `node.value` as YAML only when `path` needs a span (D-14, D-15;
 * diagnostic-range-and-position-mapping.md section 5), memoized per `node` (`parsedYamlOf`).
 * Falls back to the whole frontmatter block's span when `path` is `[]`, the leaf can't be found,
 * or the YAML re-parse itself is fatal (it already decoded once upstream, so a fatal re-parse
 * should not happen; this is defense only). For a double-quoted scalar, the yaml kit reports the
 * offset and length INCLUDING the delimiting quote characters, so the returned span covers them
 * too.
 *
 * @internal
 */
export const frontmatterPathSpan = (
	text: string,
	node: Frontmatter,
	path: ReadonlyArray<string | number>,
): OffsetSpan => {
	if (path.length === 0) return blockSpan(node);
	const parsed = parsedYamlOf(node);
	if (Result.isFailure(parsed) || parsed.success.contents === null) return blockSpan(node);
	const hit = parsed.success.contents.find(path as YamlPath);
	if (Option.isNone(hit)) return blockSpan(node);
	return { offset: toFileOffset(text, hit.value.offset), length: hit.value.length };
};
