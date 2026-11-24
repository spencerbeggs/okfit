import type { MarkdownEdit } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import { YamlScalar } from "@effected/yaml";
import type { LoadedConcept, OkfitConfig } from "@okfit/core";
import { INTEGRITY_KEY, Integrity } from "@okfit/core";
import type { ProfileFieldName } from "@okfit/profiles";
import { Derivation, PROFILE_FIELD_NAMES, ProfileKeys } from "@okfit/profiles";
import type { Effect } from "effect";
import { Effect as E, Option, Schema } from "effect";
import { classifyLegacyIntegrity, hasMergeKey, parseTopLevelMapping, renameKey } from "../verify/locate.js";

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
	return Option.getOrUndefined(decodeIntegrity(concept.frontmatter.raw[renames.integrity.from]));
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

/**
 * Plan the key-token renames for one concept's frontmatter: the profile fields for its type, plus the
 * integrity key when the located legacy block has at least one slot (an empty or null block is rewritten
 * whole by the slot splice, which renders the new key). Only key tokens move; a value, quote style, anchor,
 * comment and order stay, and every edit is a non-overlapping span of `text`, the BOM-stripped source.
 * Planning the output again gives `none`.
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

	const findPair = (name: string) =>
		contents.items.find((item) => item.key instanceof YamlScalar && item.key.value === name);

	const edits: Array<MarkdownEdit> = [];
	const keys: Array<string> = [];
	const conflicts: Array<string> = [];
	const rename = (pair: NonNullable<ReturnType<typeof findPair>>, entry: KeyRename): void => {
		if (findPair(entry.to) !== undefined) {
			conflicts.push(entry.from);
			return;
		}
		edits.push(renameKey({ offset: valueStart + pair.key.offset, length: pair.key.length }, entry.to, text));
		keys.push(entry.from);
	};

	const candidates = fieldRenames.flatMap((entry) => {
		const pair = findPair(entry.from);
		return pair === undefined ? [] : [{ pair, entry }];
	});
	const legacy = renames.integrity === undefined ? undefined : findPair(renames.integrity.from);
	const legacyShape = legacy === undefined ? "foreign" : classifyLegacyIntegrity(legacy.value);
	const legacyIsOurs = legacyShape !== "foreign";
	// A merge key may supply any renamed key, so the document cannot be judged key by key.
	if (contents.style === "flow") return { _tag: "unsupported", shape: "flow-document" };
	if (hasMergeKey(contents)) return { _tag: "unsupported", shape: "merge-key" };
	if (candidates.length === 0 && !legacyIsOurs) return NONE;

	if (legacyShape === "flow") return { _tag: "unsupported", shape: "flow-mapping" };
	if (legacyShape === "opaque") return { _tag: "unsupported", shape: "alias" };

	for (const { pair, entry } of candidates) rename(pair, entry);
	if (legacy !== undefined && renames.integrity !== undefined && legacyIsOurs) {
		if (legacyShape === "empty") {
			if (findPair(renames.integrity.to) !== undefined) conflicts.push(renames.integrity.from);
		} else rename(legacy, renames.integrity);
	}

	if (conflicts.length > 0) return { _tag: "conflict", keys: conflicts };
	return edits.length === 0 ? NONE : { _tag: "edits", edits, keys };
});
