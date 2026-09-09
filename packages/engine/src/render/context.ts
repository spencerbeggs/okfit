import type { OkfitConfig } from "@okfit/core";
import { Schema } from "effect";

/** One `types[]` entry (M-15). @public */
export const ContextType = Schema.Struct({
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	guidance: Schema.NullOr(Schema.String),
});
/** @public */
export type ContextType = typeof ContextType.Type;

/** One `tags[]` entry (M-15). @public */
export const ContextTag = Schema.Struct({
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
});
/** @public */
export type ContextTag = typeof ContextTag.Type;

/**
 * M-15's envelope: schema 1, snake_case, orientation data only. Distinct
 * from `JsonEnvelope` (`render/json.ts`) — `context` never runs conformance
 * or lint checks, so there is no `diagnostics` array and no `exit_code`
 * field at all.
 *
 * Every field is `Schema.NullOr`, never `Schema.optionalKey`: a consumer
 * (the two hook scripts) reads a fixed key set and gets JSON `null` for an
 * absent value, rather than having to distinguish a missing key from a
 * null one. This is a deliberate difference from `JsonDiagnostic`'s
 * `range`, which is `optionalKey` and omitted when absent
 * (`render/json.ts:14,68`).
 *
 * `profile_requested` (final-review Important 1) is the profile name the
 * config asked for after the K-4 default rule — `resolveProjectConfig`'s
 * own `profileName` — and is `null` only when no config file was found at
 * all. `profile` keeps its original meaning (the resolved profile's name,
 * or `null` when the requested name is unknown or `"none"`). The two
 * differ exactly when a config named an unrecognised profile: `profile`
 * is `null` but `profile_requested` still names what was asked for, so a
 * consumer can tell "no profile configured" apart from "an unknown profile
 * was configured".
 *
 * @public
 */
export const ContextEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	project_root: Schema.String,
	bundle_root: Schema.String,
	config_path: Schema.NullOr(Schema.String),
	profile: Schema.NullOr(Schema.String),
	profile_requested: Schema.NullOr(Schema.String),
	index_path: Schema.String,
	index_exists: Schema.Boolean,
	actors: Schema.Struct({ agent: Schema.NullOr(Schema.String) }),
	types: Schema.Array(ContextType),
	tags: Schema.Array(ContextTag),
});
/** @public */
export type ContextEnvelope = typeof ContextEnvelope.Type;

/**
 * Build the envelope from the merged config. `types`/`tags` sort by `name`
 * with plain code-unit comparison, never locale-dependent — the same rule
 * `render/sort.ts`'s K-17 comparator and
 * `packages/profiles/src/SoftwareProject.ts:119`'s own sort use.
 *
 * @public
 */
export const contextEnvelope = (input: {
	readonly projectRoot: string;
	readonly bundleRoot: string;
	readonly configPath: string | null;
	readonly profile: string | null;
	readonly profileRequested: string | null;
	readonly indexPath: string;
	readonly indexExists: boolean;
	readonly config: OkfitConfig;
}): ContextEnvelope => ({
	schema: 1,
	project_root: input.projectRoot,
	bundle_root: input.bundleRoot,
	config_path: input.configPath,
	profile: input.profile,
	profile_requested: input.profileRequested,
	index_path: input.indexPath,
	index_exists: input.indexExists,
	actors: { agent: input.config.actors?.agent ?? null },
	types: Object.entries(input.config.types ?? {})
		.map(([name, decl]) => ({
			name,
			description: decl.description ?? null,
			guidance: decl.guidance ?? null,
		}))
		.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
	tags: Object.entries(input.config.tags ?? {})
		.map(([name, decl]) => ({ name, description: decl.description ?? null }))
		.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
});
