import type { MarkdownEdit } from "@effected/markdown";
import type { YamlMap, YamlParseError } from "@effected/yaml";
import { YamlScalar } from "@effected/yaml";
import type { LoadedConcept, OkfitConfig } from "@okfit/core";
import { INTEGRITY_KEY, Integrity } from "@okfit/core";
import type { ProfileFieldName } from "@okfit/profiles";
import { Derivation, PROFILE_FIELD_NAMES, ProfileKeys } from "@okfit/profiles";
import type { Effect } from "effect";
import { Effect as E, Option, Schema } from "effect";
import {
	classifyLegacyIntegrity,
	isLegacyIntegrityValue,
	isLegacySlotKeys,
	parseTopLevelMapping,
	renameKey,
} from "../verify/locate.js";

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
 * `T` declares `names[k]`, does not declare `k` and does not list `k` in its `required`, so a project that keeps its own bare `kind`, uses
 * `profile = "none"` or defines a custom type is left alone. A rename whose two spellings are equal is
 * dropped, and `integrity` is `undefined` while {@link INTEGRITY_KEY} is the legacy spelling.
 *
 * @remarks
 * A project's own config naming a built-in field by its bare name, in `fields` or in `required`, keeps that
 * field unrenamed for that type: the project updates its config by hand, then `okfit sync` renames the key.
 *
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
		const required = definition.required ?? [];
		const renames: Array<KeyRename> = [];
		for (const from of PROFILE_FIELD_NAMES) {
			const to = names[from];
			if (to !== from && Object.hasOwn(declared, to) && !Object.hasOwn(declared, from) && !required.includes(from)) {
				renames.push({ from, to });
			}
		}
		if (renames.length > 0) fields.set(type, renames);
	}
	const target: string = INTEGRITY_KEY;
	const integrity = target === LEGACY_INTEGRITY_KEY ? undefined : { from: LEGACY_INTEGRITY_KEY, to: target };
	return { integrity, fields };
};

/** The spelling of the Publication `renders` field before it moved under the `x-okfit-` namespace. @internal */
export const LEGACY_RENDERS_KEY = "renders";

/**
 * The key under which `concept` holds its Publication renders list: the current spelling when it is there,
 * else the legacy one while this run is licensed to rename it (D3). `undefined` when neither is present.
 * The legacy digest migration (`renders[].body_sha256` to `body`) runs under whichever spelling the file
 * has, in the same pass as the key rename; their edits are disjoint (the key token versus the entries).
 *
 * @internal
 */
export const rendersKeyFor = (concept: LoadedConcept, renames: KeyRenames): string | undefined => {
	const raw = concept.frontmatter.raw;
	if (Object.hasOwn(raw, ProfileKeys.renders)) return ProfileKeys.renders;
	const licensed = (renames.fields.get(concept.frontmatter.type) ?? []).some(
		(rename) => rename.from === LEGACY_RENDERS_KEY,
	);
	return licensed && Object.hasOwn(raw, LEGACY_RENDERS_KEY) ? LEGACY_RENDERS_KEY : undefined;
};

/**
 * D2 plus a `<<` merge key: a legacy block that merges another mapping in is still okfit's legacy block as
 * far as verify is concerned (it refuses it), so sync must see it too and skip it as unsupported.
 *
 * @internal
 */
export const isLegacyBlock = (value: unknown): boolean => {
	if (isLegacyIntegrityValue(value)) return true;
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const keys = Object.keys(value);
	return keys.includes("<<") && isLegacySlotKeys(keys.filter((key) => key !== "<<"));
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
 * A document is refused (`unsupported`) only when okfit's decoded frontmatter holds a legacy key that cannot
 * be renamed in place: one written in a flow-style document or as an explicit `?` key, repeated at the top
 * level, or an integrity value that is a flow mapping or alias. A key that only a `<<` merge supplies is not
 * in the decoded frontmatter, which does not expand merges, so okfit reads nothing there to rename. A document with nothing to rename is `none`
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

	const raw = concept.frontmatter.raw;
	const entries: ReadonlyArray<KeyRename> =
		renames.integrity === undefined ? fieldRenames : [...fieldRenames, renames.integrity];
	const isIntegrity = (entry: KeyRename): boolean => entry === renames.integrity;
	const direct = (name: string) => contents.items.filter((item) => keyName(item) === name);

	// What okfit itself reads (`raw`, the decoded frontmatter, which does not expand `<<`) decides what is
	// there to rename; the parsed tree only supplies the key tokens.
	const present = entries.filter((entry) => {
		if (!Object.hasOwn(raw, entry.from)) return false;
		return !isIntegrity(entry) || raw[entry.from] === null || isLegacyBlock(raw[entry.from]);
	});
	const emptyIntegrity = (entry: KeyRename): boolean => isIntegrity(entry) && raw[entry.from] === null;
	const conflicts = present.filter((entry) => Object.hasOwn(raw, entry.to)).map((entry) => entry.from);
	const renamable = present.filter((entry) => !emptyIntegrity(entry));
	if (renamable.length === 0 && conflicts.length === 0) return NONE;

	if (contents.style === "flow") return { _tag: "unsupported", shape: "flow-document" };
	for (const entry of present) {
		const pairs = direct(entry.from);
		if (pairs.length === 0) return { _tag: "unsupported", shape: "not-a-top-level-key" };
		if (pairs.length > 1) return { _tag: "unsupported", shape: `duplicate-key:${entry.from}` };
		const pair = pairs[0] as Pair;
		const abs = valueStart + pair.key.offset;
		const prefix = text.slice(text.lastIndexOf("\n", abs - 1) + 1, abs);
		if (/^\s*\?\s*$/u.test(prefix)) return { _tag: "unsupported", shape: "explicit-key" };
		if (isIntegrity(entry)) {
			const shape = classifyLegacyIntegrity(pair.value);
			if (shape === "flow") return { _tag: "unsupported", shape: "flow-mapping" };
			if (shape === "opaque") return { _tag: "unsupported", shape: "alias" };
		}
	}
	if (conflicts.length > 0) return { _tag: "conflict", keys: conflicts };

	const edits = renamable.map((entry) => {
		const pair = direct(entry.from)[0] as Pair;
		return renameKey({ offset: valueStart + pair.key.offset, length: pair.key.length }, entry.to, text);
	});
	return { _tag: "edits", edits, keys: renamable.map((entry) => entry.from) };
});
