import type { Frontmatter } from "@effected/markdown";
import type { YamlNode, YamlParseError, YamlPath } from "@effected/yaml";
import { YamlDocument, YamlMap, YamlScalar } from "@effected/yaml";
import { Option, Result } from "effect";
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
	const parsed = YamlDocument.parseResult(node.value);
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
): OffsetSpan => (path.length === 0 ? blockSpan(node) : (findFrontmatterPathSpan(text, node, path) ?? blockSpan(node)));

/**
 * The file span of the YAML node at `path`, or `undefined` when there is none (or the re-parse is
 * fatal): {@link frontmatterPathSpan} without its whole-block fallback, for a caller that would
 * rather carry no range than a wrong one. Same quoting rule: a double-quoted scalar's span covers
 * its quotes. A bare `key:` has no value node and a tagged empty value (`key: !!null`) has no text
 * (the kit reports a zero-length span just after the tag), so neither has a value span: both answer `undefined`.
 * An edit that splices into the returned span relies on it being the value's own text, so it is never the key's;
 * {@link findFrontmatterAnchorSpan} is the diagnostic reading.
 *
 * @internal
 */
export const findFrontmatterPathSpan = (
	text: string,
	node: Frontmatter,
	path: ReadonlyArray<string | number>,
): OffsetSpan | undefined => {
	const parsed = parsedYamlOf(node);
	if (Result.isFailure(parsed) || parsed.success.contents === null) return undefined;
	const hit = parsed.success.contents.find(path as YamlPath);
	if (Option.isNone(hit) || hit.value.length === 0) return undefined;
	return { offset: toFileOffset(text, hit.value.offset), length: hit.value.length };
};

/**
 * The source text of the scalar at `path`, as its author wrote it (an unquoted `0.10` reads `"0.10"`, where YAML's
 * value is `0.1`), or `undefined` when the node is not a scalar with text or the re-parse is fatal. Quotes are
 * included for a quoted scalar; a tag or anchor never is.
 *
 * @internal
 */
export const findFrontmatterScalarSource = (
	node: Frontmatter,
	path: ReadonlyArray<string | number>,
): string | undefined => {
	const parsed = parsedYamlOf(node);
	if (Result.isFailure(parsed) || parsed.success.contents === null) return undefined;
	const hit = parsed.success.contents.find(path as YamlPath);
	if (Option.isNone(hit) || !(hit.value instanceof YamlScalar)) return undefined;
	const source = hit.value.sourceText(node.value);
	return source === "" ? undefined : source;
};

/**
 * The file span of the key at `path` (its last segment must be a mapping key), or `undefined` when the key is not
 * written or the re-parse is fatal.
 *
 * @internal
 */
export const findFrontmatterKeySpan = (
	text: string,
	node: Frontmatter,
	path: ReadonlyArray<string | number>,
): OffsetSpan | undefined => {
	const parsed = parsedYamlOf(node);
	if (Result.isFailure(parsed) || parsed.success.contents === null) return undefined;
	return keySpan(text, parsed.success.contents, path);
};

/**
 * Where a diagnostic about `path` points: the value's own span, or the key's when the value has no text (a bare
 * `key:` or a tagged empty value), or `undefined` when neither exists. For diagnostics only: an edit must not splice
 * into the key, so it uses {@link findFrontmatterPathSpan}.
 *
 * @internal
 */
export const findFrontmatterAnchorSpan = (
	text: string,
	node: Frontmatter,
	path: ReadonlyArray<string | number>,
): OffsetSpan | undefined => findFrontmatterPathSpan(text, node, path) ?? findFrontmatterKeySpan(text, node, path);

/**
 * {@link findFrontmatterAnchorSpan} with {@link frontmatterPathSpan}'s whole-block fallback.
 *
 * @internal
 */
export const frontmatterAnchorSpan = (
	text: string,
	node: Frontmatter,
	path: ReadonlyArray<string | number>,
): OffsetSpan =>
	path.length === 0 ? blockSpan(node) : (findFrontmatterAnchorSpan(text, node, path) ?? blockSpan(node));

/** The pair of `map` whose key is the plain scalar `key`. */
const pairOf = (map: YamlMap, key: string) =>
	map.items.find((item) => item.key instanceof YamlScalar && item.key.value === key);

const keySpan = (text: string, contents: YamlNode, path: ReadonlyArray<string | number>): OffsetSpan | undefined => {
	const key = path.at(-1);
	if (typeof key !== "string") return undefined;
	const parent = path.length === 1 ? Option.some(contents) : contents.find(path.slice(0, -1) as YamlPath);
	if (Option.isNone(parent) || !(parent.value instanceof YamlMap)) return undefined;
	const pair = pairOf(parent.value, key);
	return pair === undefined ? undefined : { offset: toFileOffset(text, pair.key.offset), length: pair.key.length };
};

/**
 * Whether the top-level `key` is a value `okfit sync` can replace whole: unwritten, a bare `key:`, or an untagged,
 * unanchored plain null (`null`, `~`) in a block-style mapping. This mirrors the engine's `locateGeneratedBlock`
 * (`engine/src/verify/locate.ts`), which core cannot import: a tagged or anchored null (`!!null`, `&a ~`) carries
 * syntax a whole-line replace would drop or duplicate, so sync skips it as `generated-unsupported`. A re-parse that
 * fails or a non-mapping document answers `false`, as the engine reports those unsupported too.
 *
 * @internal
 */
export const isReplaceableNull = (node: Frontmatter, key: string): boolean => {
	const parsed = parsedYamlOf(node);
	if (Result.isFailure(parsed)) return false;
	const contents = parsed.success.contents;
	if (!(contents instanceof YamlMap) || contents.style === "flow") return false;
	const pair = pairOf(contents, key);
	if (pair === undefined) return true;
	const value = pair.value;
	const isNull =
		value === null ||
		(value instanceof YamlScalar &&
			value.style === "plain" &&
			value.value === null &&
			value.tag === undefined &&
			value.anchor === undefined);
	// The engine also requires the key to begin its line (only indentation before it), so an explicit `? key` entry,
	// whose key follows other text, is not replaceable either.
	const lineStart = node.value.lastIndexOf("\n", pair.key.offset - 1) + 1;
	return isNull && node.value.slice(lineStart, pair.key.offset).trim() === "";
};
