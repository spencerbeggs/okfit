import type { MarkdownEdit } from "@effected/markdown";
import type { YamlNode, YamlParseError } from "@effected/yaml";
import { YamlAlias, YamlMap, YamlScalar, YamlSeq } from "@effected/yaml";
import type { LoadedConcept, OkfitConfig } from "@okfit/core";
import { INTEGRITY_KEY, Integrity } from "@okfit/core";
import type { ProfileFieldName } from "@okfit/profiles";
import { Derivation, PROFILE_FIELD_NAMES, ProfileKeys } from "@okfit/profiles";
import type { Effect } from "effect";
import { Effect as E, Option, Schema } from "effect";
import { classifyLegacyIntegrity, isLegacyIntegrityValue, parseTopLevelMapping, renameKey } from "../verify/locate.js";

/**
 * The spelling okfit's integrity block had before it moved under the `x-okfit-` namespace. The one home of
 * the old spelling: only the migration reads it.
 *
 * @internal
 */
export const LEGACY_INTEGRITY_KEY = "integrity";

/** One key to rename, `from` the spelling in the file and `to` the spelling okfit now owns. @internal */
export interface KeyRename {
	readonly from: string;
	readonly to: string;
}

/**
 * Every rename a sync run may apply: the integrity key (`undefined` when it has not moved) and, per concept
 * type, the profile fields to rename. Empty in production until the constants change.
 *
 * @internal
 */
export interface KeyRenames {
	readonly integrity: KeyRename | undefined;
	readonly fields: ReadonlyMap<string, ReadonlyArray<KeyRename>>;
}

/**
 * The renames `config` licenses (D3). On a type `T`, a profile field `k` is renamed to `names[k]` only when
 * `T` declares `names[k]` and does not declare `k`, so a project that keeps its own bare `kind`, uses
 * `profile = "none"` or defines a custom type is left alone. A rename whose two spellings are equal is
 * dropped, and `integrity` is `undefined` while {@link INTEGRITY_KEY} is the legacy spelling.
 *
 * @remarks
 * `names` defaults to {@link ProfileKeys}; it exists so a test can name a target spelling without changing
 * the production table.
 *
 * @internal
 */
export const keyRenamesFor = (
	config: OkfitConfig,
	names: Readonly<Record<ProfileFieldName, string>> = ProfileKeys,
): KeyRenames => {
	const fields = new Map<string, ReadonlyArray<KeyRename>>();
	for (const [type, definition] of Object.entries(config.types ?? {})) {
		const declared = definition.fields ?? {};
		const renames: Array<KeyRename> = [];
		for (const from of PROFILE_FIELD_NAMES) {
			const to = names[from];
			if (to !== from && Object.hasOwn(declared, to) && !Object.hasOwn(declared, from)) renames.push({ from, to });
		}
		if (renames.length > 0) fields.set(type, renames);
	}
	const integrity =
		INTEGRITY_KEY === LEGACY_INTEGRITY_KEY ? undefined : { from: LEGACY_INTEGRITY_KEY, to: INTEGRITY_KEY };
	return { integrity, fields };
};

const decodeIntegrity = Schema.decodeUnknownOption(Integrity);

/**
 * The legacy integrity block of `concept`, decoded through core's {@link Integrity}. `undefined` when there
 * is no rename, no block, or the block is malformed.
 *
 * @internal
 */
export const legacyIntegrity = (concept: LoadedConcept, renames: KeyRenames): Integrity | undefined => {
	if (renames.integrity === undefined) return undefined;
	const raw = concept.frontmatter.raw[renames.integrity.from];
	return isLegacyIntegrityValue(raw) ? Option.getOrUndefined(decodeIntegrity(raw)) : undefined;
};

/**
 * The body digest recorded for `concept`: the current record, else the legacy block's, so sync keeps
 * reading an unmigrated concept's digest as current instead of re-stamping it.
 *
 * @internal
 */
export const recordedBodyForSync = (concept: LoadedConcept, renames: KeyRenames): string | undefined =>
	Derivation.recordedBody(concept) ?? legacyIntegrity(concept, renames)?.generated?.body;

/**
 * What {@link planKeyRenames} decided: `none` (nothing to rename), the `edits` that rename the key tokens
 * (`keys` names each `from` spelling), a `conflict` (both spellings present), or `unsupported` (a legacy key
 * that cannot be renamed in place).
 *
 * @internal
 */
export type KeyRenamePlan =
	| { readonly _tag: "none" }
	| { readonly _tag: "edits"; readonly edits: ReadonlyArray<MarkdownEdit>; readonly keys: ReadonlyArray<string> }
	| { readonly _tag: "conflict"; readonly keys: ReadonlyArray<string> }
	| { readonly _tag: "unsupported"; readonly shape: string };

const NONE: KeyRenamePlan = { _tag: "none" };

type Pair = YamlMap["items"][number];

/** Every anchored node in `node`, by anchor name (document scope). */
const collectAnchors = (node: YamlNode | null, into: Map<string, YamlNode>): Map<string, YamlNode> => {
	if (node === null || node instanceof YamlAlias) return into;
	if ("anchor" in node && typeof node.anchor === "string") into.set(node.anchor, node);
	if (node instanceof YamlMap) {
		for (const item of node.items) {
			collectAnchors(item.key, into);
			collectAnchors(item.value, into);
		}
	} else if (node instanceof YamlSeq) {
		for (const item of node.items) collectAnchors(item, into);
	}
	return into;
};

/** The pairs a `<<` merge key supplies to `map` (aliases resolved, nested merges followed). */
const mergedPairs = (map: YamlMap, anchors: ReadonlyMap<string, YamlNode>, depth = 0): ReadonlyArray<Pair> => {
	if (depth > 8) return [];
	const sources = (node: YamlNode | null): ReadonlyArray<YamlMap> => {
		if (node instanceof YamlAlias) {
			const target = anchors.get(node.name);
			return target instanceof YamlMap ? [target] : [];
		}
		if (node instanceof YamlMap) return [node];
		if (node instanceof YamlSeq) return node.items.flatMap(sources);
		return [];
	};
	return map.items
		.filter((item) => item.key instanceof YamlScalar && item.key.value === "<<")
		.flatMap((item) => sources(item.value))
		.flatMap((source) => [...source.items, ...mergedPairs(source, anchors, depth + 1)]);
};

const keyName = (pair: Pair): string | undefined =>
	pair.key instanceof YamlScalar ? String(pair.key.value) : undefined;

/**
 * Plan the key-token renames for one concept's frontmatter: the profile fields for its type, plus the
 * integrity key when the located legacy block has at least one slot (an empty or null block is rewritten
 * whole by the slot splice, which renders the new key). Only key tokens move; a value, quote style, anchor,
 * comment and order stay, and every edit is a non-overlapping span of `text`, the BOM-stripped source.
 * Planning the output again gives `none`.
 *
 * @remarks
 * A document is refused (`unsupported`) only when it holds a legacy key that cannot be renamed in place: one
 * supplied by a `<<` merge, written in a flow-style document or as an explicit `?` key, repeated at the top
 * level, or an integrity value that is a flow mapping or alias. A document with nothing to rename is `none`
 * whatever its shape.
 *
 * @internal
 */
export const planKeyRenames = E.fn("okfit/sync/planKeyRenames")(function* (
	text: string,
	concept: LoadedConcept,
	renames: KeyRenames,
): Generator<Effect.Effect<Effect.Success<ReturnType<typeof parseTopLevelMapping>>, YamlParseError>, KeyRenamePlan> {
	const fieldRenames = renames.fields.get(concept.frontmatter.type) ?? [];
	if (fieldRenames.length === 0 && renames.integrity === undefined) return NONE;
	const parsed = yield* parseTopLevelMapping(text);
	if ("_tag" in parsed) return NONE;
	const { valueStart, contents } = parsed;

	const entries: ReadonlyArray<KeyRename> =
		renames.integrity === undefined ? fieldRenames : [...fieldRenames, renames.integrity];
	const isIntegrity = (entry: KeyRename): boolean => entry === renames.integrity;
	/** Whether a pair under `entry.from` is okfit's (an integrity pair must satisfy D2). */
	const owned = (pair: Pair, entry: KeyRename): boolean =>
		isIntegrity(entry) ? classifyLegacyIntegrity(pair.value) !== "foreign" : true;

	const direct = (name: string) => contents.items.filter((item) => keyName(item) === name);
	const merged = mergedPairs(contents, collectAnchors(contents, new Map()));

	// What this document holds that is okfit's legacy spelling, found directly and through `<<`.
	const present = entries.flatMap((entry) => {
		const pairs = direct(entry.from).filter((pair) => owned(pair, entry));
		const viaMerge = merged.filter((pair) => keyName(pair) === entry.from && owned(pair, entry));
		return pairs.length === 0 && viaMerge.length === 0 ? [] : [{ entry, pairs, viaMerge }];
	});
	// An empty legacy integrity (null) has no slot to rename; it matters only if the new key is also present.
	const renamable = present.filter(
		({ entry, pairs }) =>
			!isIntegrity(entry) ||
			pairs.some((pair) => classifyLegacyIntegrity(pair.value) !== "empty") ||
			pairs.length === 0,
	);
	const conflicts = present.filter(({ entry }) => direct(entry.to).length > 0).map(({ entry }) => entry.from);
	if (renamable.length === 0 && conflicts.length === 0) return NONE;

	if (contents.style === "flow") return { _tag: "unsupported", shape: "flow-document" };
	if (present.some(({ viaMerge }) => viaMerge.length > 0)) return { _tag: "unsupported", shape: "merge-key" };
	for (const { entry, pairs } of present) {
		if (pairs.length > 1) return { _tag: "unsupported", shape: `duplicate-key:${entry.from}` };
		for (const pair of pairs) {
			const abs = valueStart + pair.key.offset;
			const prefix = text.slice(text.lastIndexOf("\n", abs - 1) + 1, abs);
			if (/^\s*\?\s*$/u.test(prefix)) return { _tag: "unsupported", shape: "explicit-key" };
			if (isIntegrity(entry)) {
				const shape = classifyLegacyIntegrity(pair.value);
				if (shape === "flow") return { _tag: "unsupported", shape: "flow-mapping" };
				if (shape === "opaque") return { _tag: "unsupported", shape: "alias" };
			}
		}
	}
	if (conflicts.length > 0) return { _tag: "conflict", keys: conflicts };

	const edits: Array<MarkdownEdit> = [];
	const keys: Array<string> = [];
	for (const { entry, pairs } of renamable) {
		for (const pair of pairs) {
			if (isIntegrity(entry) && classifyLegacyIntegrity(pair.value) === "empty") continue;
			edits.push(renameKey({ offset: valueStart + pair.key.offset, length: pair.key.length }, entry.to, text));
			keys.push(entry.from);
		}
	}
	return edits.length === 0 ? NONE : { _tag: "edits", edits, keys };
});
