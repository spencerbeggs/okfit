import type { ConfigReadError } from "@effected/config-file";
import { ConfigFile, TomlCodec } from "@effected/config-file";
import type { FileSystem } from "effect";
import { Duration, Effect, Option, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect";
import { Actor } from "./Actor.js";
import type { DiagnosticSeverity, LintCode } from "./Diagnostic.js";

/**
 * Severity a lint rule is configured to. `"info"` extends spec 4.2's
 * `off | warn | error` so the D-34 `info` defaults are expressible.
 *
 * @public
 */
export const LintLevel = Schema.Literals(["off", "info", "warn", "error"]).annotate({
	title: "Lint severity",
	description: "off — never reported; info, warn, error — the diagnostic's rendered severity.",
	"x-taplo": {
		docs: {
			enumValues: ["Never reported.", "Reported as information.", "Reported as a warning.", "Reported as an error."],
		},
	},
});

/**
 * The type of `LintLevel`.
 * @public
 */
export type LintLevel = typeof LintLevel.Type;

const SHORT_DURATION_RE = /^(\d+)(h|d|w)$/;
const LONG_DURATION_RE = /^\d+(?:\.\d+)?\s+(?:nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/;
// The union of the two regexes above, as a single check on the encoded
// string (I4): unlike a raw `pattern` annotation key, `Schema.isPattern`'s
// check is what `Schema.toJsonSchemaDocument` actually lowers into the
// document's `pattern` keyword (the same mechanism `Actor.ts` uses), so an
// editor rejects a value (e.g. "soon") that okfit itself would otherwise
// fail the whole config load on.
const STALE_AFTER_PATTERN_RE =
	/^(?:\d+[hdw]|\d+(?:\.\d+)?\s+(?:nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?))$/;
const HOUR_MILLIS = 3_600_000;
const DAY_MILLIS = 86_400_000;
const WEEK_MILLIS = 604_800_000;

const parseStaleAfter = (input: string): Option.Option<Duration.Duration> => {
	const short = SHORT_DURATION_RE.exec(input);
	if (short !== null) {
		const amount = Number(short[1]);
		switch (short[2]) {
			case "h":
				return Option.some(Duration.hours(amount));
			case "d":
				return Option.some(Duration.days(amount));
			default:
				return Option.some(Duration.weeks(amount));
		}
	}
	if (LONG_DURATION_RE.test(input)) {
		return Duration.fromInput(input as Duration.Input);
	}
	return Option.none();
};

const formatStaleAfter = (duration: Duration.Duration): string => {
	const millis = Duration.toMillis(duration);
	if (Number.isInteger(millis) && millis >= 0) {
		if (millis !== 0 && millis % WEEK_MILLIS === 0) return `${millis / WEEK_MILLIS}w`;
		if (millis % DAY_MILLIS === 0) return `${millis / DAY_MILLIS}d`;
		if (millis % HOUR_MILLIS === 0) return `${millis / HOUR_MILLIS}h`;
	}
	return `${millis} millis`;
};

/**
 * `lifecycle.default_stale_after` codec: `^(\d+)(h|d|w)$` or Effect's
 * `"<n> <unit>"` form decodes to a `Duration` (D-30). Encoding emits the
 * shortest exact `w`/`d`/`h` spelling, otherwise `"<n> millis"`.
 *
 * @remarks
 * `@effected/toml` has no duration syntax and `Schema.DurationFromString`
 * rejects `"90d"`, so this is core's own codec (effected-yaml-toml-config-file-app.md §2).
 *
 * @public
 */
export const StaleAfterDuration: Schema.Codec<Duration.Duration, string> = Schema.annotateEncoded<
	Schema.Codec<Duration.Duration, string>
>({
	title: "Stale-after duration",
	description:
		'How long a concept may go unedited before lint `stale` fires. Accepts "<n>h", "<n>d", "<n>w", or Effect\'s "<n> <unit>" long form.',
	default: "90d",
	examples: ["90d", "2w", "12h"],
})(
	Schema.String.pipe(
		Schema.check(
			Schema.isPattern(STALE_AFTER_PATTERN_RE, {
				message: 'expected "<n>h", "<n>d", "<n>w" or "<n> <unit>"',
			}),
		),
		Schema.decodeTo(Schema.Duration, {
			decode: SchemaGetter.transformEffect<Duration.Duration, string>((input, options) =>
				Option.match(parseStaleAfter(input), {
					onNone: () =>
						Effect.fail(
							new SchemaIssue.InvalidValue(
								{ message: `expected "<n>h", "<n>d", "<n>w" or "<n> <unit>", got ${JSON.stringify(input)}` },
								input,
								options,
							),
						),
					onSome: Effect.succeed,
				}),
			),
			encode: SchemaGetter.transform(formatStaleAfter),
		}),
	),
);

/**
 * A `types.<Name>.fields.<key>` declaration (spec 4.2): a description plus
 * either an enum of values with descriptions or `kind = "path"`.
 * @public
 */
export const FieldDeclaration = Schema.Struct({
	description: Schema.String.annotate({ description: "What this extension field means." }),
	values: Schema.optionalKey(
		Schema.Record(Schema.String, Schema.String).annotate({
			description: "The allowed values, each with a one-sentence description.",
		}),
	),
	kind: Schema.optionalKey(
		Schema.Literal("path").annotate({
			description: '"path": the value is a concept id or file path, not one of an enumerated set.',
			examples: ["path"],
		}),
	),
}).annotate({
	title: "Extension field",
	description: "One `[types.<Name>.fields.<key>]` declaration.",
});

/**
 * A `types.<Name>` declaration (spec 4.2).
 * @public
 */
export const TypeDeclaration = Schema.Struct({
	description: Schema.optionalKey(
		Schema.String.annotate({ description: "One-sentence summary of what this type represents." }),
	),
	guidance: Schema.optionalKey(
		Schema.String.annotate({
			description: "Longer guidance shown to an authoring agent or human writing a concept of this type.",
		}),
	),
	required: Schema.optionalKey(
		Schema.Array(Schema.String).annotate({
			description: "Frontmatter keys a concept of this type must carry, beyond `concepts.required`.",
		}),
	),
	require_verified: Schema.optionalKey(
		Schema.Boolean.annotate({
			description:
				"Whether a concept of this type must carry a `verified` entry to satisfy lint `require-verified-unmet`.",
			default: false,
		}),
	),
	fields: Schema.optionalKey(
		Schema.Record(Schema.String, FieldDeclaration).annotate({
			description: "Extension fields this type's frontmatter may declare.",
		}),
	),
}).annotate({
	title: "Concept type",
	description: "One `[types.<Name>]` declaration.",
});

/**
 * A `tags.<name>` declaration (spec 4.2).
 * @public
 */
export const TagDeclaration = Schema.Struct({
	description: Schema.optionalKey(
		Schema.String.annotate({ description: "One-sentence summary of what applying this tag means." }),
	),
}).annotate({ title: "Tag", description: "One `[tags.<name>]` declaration." });

/**
 * The `[lint]` table: one optional `LintLevel` per lint code, snake_case (D-34).
 * @public
 */
export const LintTable = Schema.Struct({
	broken_links: Schema.optionalKey(
		LintLevel.annotate({
			title: "broken-links",
			description: 'A link in a concept\'s body or frontmatter does not resolve. Default "warn".',
			default: "warn",
		}),
	),
	missing_index: Schema.optionalKey(
		LintLevel.annotate({
			title: "missing-index",
			description: 'A concept-holding directory has no index.md. Default "warn".',
			default: "warn",
		}),
	),
	unknown_type: Schema.optionalKey(
		LintLevel.annotate({
			title: "unknown-type",
			description:
				"A concept's type is not one of the config's declared [types.<Name>]. Default \"error\", off when no types are declared.",
			default: "error",
		}),
	),
	required_key_missing: Schema.optionalKey(
		LintLevel.annotate({
			title: "required-key-missing",
			description: 'A concept is missing a frontmatter key its type or concepts.required requires. Default "error".',
			default: "error",
		}),
	),
	field_value_unknown: Schema.optionalKey(
		LintLevel.annotate({
			title: "field-value-unknown",
			description: 'A frontmatter field\'s value is not one of its declared values. Default "error".',
			default: "error",
		}),
	),
	require_verified_unmet: Schema.optionalKey(
		LintLevel.annotate({
			title: "require-verified-unmet",
			description: 'A concept whose type sets require_verified = true carries no verified entry. Default "error".',
			default: "error",
		}),
	),
	family_invalid: Schema.optionalKey(
		LintLevel.annotate({
			title: "family-invalid",
			description: 'A concept\'s declared family does not match an accepted shape. Default "error".',
			default: "error",
		}),
	),
	computation_runtime_missing: Schema.optionalKey(
		LintLevel.annotate({
			title: "computation-runtime-missing",
			description: 'A referenced computation\'s runtime is not available. Default "error".',
			default: "error",
		}),
	),
	footnote_source_unknown: Schema.optionalKey(
		LintLevel.annotate({
			title: "footnote-source-unknown",
			description: 'A footnote\'s source does not resolve. Default "warn".',
			default: "warn",
		}),
	),
	log_frontmatter: Schema.optionalKey(
		LintLevel.annotate({
			title: "log-frontmatter",
			description: 'log.md carries frontmatter, which the spec reserves against. Default "warn".',
			default: "warn",
		}),
	),
	actor_prefix_unknown: Schema.optionalKey(
		LintLevel.annotate({
			title: "actor-prefix-unknown",
			description: 'An actor\'s prefix is not human, process, or a producer shape. Default "info".',
			default: "info",
		}),
	),
	legacy_timestamp: Schema.optionalKey(
		LintLevel.annotate({
			title: "legacy-timestamp",
			description: 'A concept uses the legacy timestamp field instead of generated.at. Default "info".',
			default: "info",
		}),
	),
	config_unknown_key: Schema.optionalKey(
		LintLevel.annotate({
			title: "config-unknown-key",
			description: 'The config file declares a top-level key the schema does not recognize. Default "warn".',
			default: "warn",
		}),
	),
	stale: Schema.optionalKey(
		LintLevel.annotate({
			title: "stale",
			description: 'A concept has gone unedited past lifecycle.default_stale_after. Default "info".',
			default: "info",
		}),
	),
	walk_unreadable: Schema.optionalKey(
		LintLevel.annotate({
			title: "walk-unreadable",
			description: 'A directory in the bundle could not be read while walking. Default "warn".',
			default: "warn",
		}),
	),
	generated_at_drift: Schema.optionalKey(
		LintLevel.annotate({
			title: "generated-at-drift",
			description:
				'A committed concept\'s generated.at is missing or does not match its last body-changing commit, and is not otherwise authoritative (issue #19: a stamp recorded during the unchanged-body run survives a squash/rebase merge). Default "warn".',
			default: "warn",
		}),
	),
}).annotate({
	title: "Lint severities",
	description: "Per-code severity overrides. Any key omitted keeps its default.",
});

type LintTableKey = keyof typeof LintTable.fields;

/**
 * The `OkfitConfig` struct schema. Exported only so the `OkfitConfigFields`
 * type below is reachable from the rollup; the barrel never re-exports this
 * value, so it stays out of the named public surface.
 * @public
 */
export const okfitConfigFields = Schema.Struct({
	okf_version: Schema.optionalKey(
		Schema.String.annotate({
			title: "OKF spec version",
			description: "The Open Knowledge Format spec version this bundle targets.",
			default: "0.2",
			examples: ["0.2"],
		}),
	),
	bundle: Schema.optionalKey(
		Schema.Struct({
			path: Schema.optionalKey(
				Schema.String.annotate({
					title: "Bundle directory",
					description: "The OKF bundle's root directory, relative to the project root.",
					default: "okf",
					examples: ["okf"],
				}),
			),
			profile: Schema.optionalKey(
				Schema.String.annotate({
					title: "Profile name",
					description:
						'The named profile merged under `DEFAULTS < profile < file`, or "none" to disable profile merging.',
					default: "software-project",
					examples: ["software-project", "none"],
				}),
			),
		}).annotate({
			title: "Bundle location and profile",
			description: "Where the OKF bundle lives and which profile merges under it.",
		}),
	),
	concepts: Schema.optionalKey(
		Schema.Struct({
			required: Schema.optionalKey(
				Schema.Array(Schema.String).annotate({
					title: "Required frontmatter keys",
					description: "Frontmatter keys every concept must carry, beyond the spec's required set.",
					default: [],
				}),
			),
			tags: Schema.optionalKey(
				Schema.Struct({
					required: Schema.optionalKey(
						Schema.Array(Schema.String).annotate({
							title: "Required tags",
							description: "Tags every concept must carry.",
							default: [],
						}),
					),
				}),
			),
		}).annotate({
			title: "Concept-level requirements",
			description: "Requirements every concept in the bundle must satisfy, beyond the spec's own.",
		}),
	),
	lifecycle: Schema.optionalKey(
		Schema.Struct({ default_stale_after: Schema.optionalKey(StaleAfterDuration) }).annotate({
			title: "Concept lifecycle",
			description: "Staleness policy for the bundle.",
		}),
	),
	actors: Schema.optionalKey(
		Schema.Struct({
			agent: Schema.optionalKey(
				Actor.annotate({
					title: "Agent actor",
					description: "The actor id an agent writes as `generated.by`.",
				}),
			),
			humans: Schema.optionalKey(
				Schema.Array(Actor).annotate({
					title: "Human actors",
					description: 'Actor ids for the humans working in this bundle, "human:<id>" form.',
					default: [],
					examples: [["human:spencer" as Actor]],
				}),
			),
		}).annotate({
			title: "Actor identities",
			description: "Who authors and verifies concepts in this bundle.",
		}),
	),
	lint: Schema.optionalKey(LintTable),
	types: Schema.optionalKey(
		Schema.Record(Schema.String, TypeDeclaration).annotate({
			title: "Concept type declarations",
			description: "One entry per concept type, keyed by type name.",
		}),
	),
	tags: Schema.optionalKey(
		Schema.Record(Schema.String, TagDeclaration).annotate({
			title: "Tag declarations",
			description: "One entry per tag, keyed by tag name.",
		}),
	),
	extensions: Schema.Record(Schema.String, Schema.Unknown),
});

/**
 * The schema the published JSON Schema document is generated from (C-15):
 * `okfitConfigFields` minus `extensions` (wire bookkeeping no human writes),
 * with an open rest so unknown top-level keys are permitted at the root while
 * every declared table stays closed (C-16, D-31).
 *
 * @public
 */
export const okfitConfigDocumentFields = Schema.StructWithRest(
	Schema.Struct({
		okf_version: okfitConfigFields.fields.okf_version,
		bundle: okfitConfigFields.fields.bundle,
		concepts: okfitConfigFields.fields.concepts,
		lifecycle: okfitConfigFields.fields.lifecycle,
		actors: okfitConfigFields.fields.actors,
		lint: okfitConfigFields.fields.lint,
		types: okfitConfigFields.fields.types,
		tags: okfitConfigFields.fields.tags,
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
).annotate({
	title: "okfit config",
	description:
		"okfit's TOML config file (OKF spec 4.2). Unrecognized top-level keys are preserved verbatim and produce a config-unknown-key warning, never a validation error.\nhttps://github.com/spencerbeggs/okfit#configuration",
	"x-tombi-toml-version": "v1.1.0",
});

/**
 * The decoded config: spec 4.2's shape as a plain object (D-28). Every key is
 * optional except `extensions`, which holds unknown top-level keys verbatim (D-31).
 * @public
 */
export type OkfitConfig = typeof okfitConfigFields.Type;

/**
 * The field shape behind `OkfitConfig`, exported type-only so the barrel can
 * re-export the name without adding a runtime value to the public surface.
 * @public
 */
export type OkfitConfigFields = typeof okfitConfigFields.fields;

type OkfitConfigEncoded = (typeof okfitConfigFields)["Encoded"];
interface RawTable {
	readonly [key: string]: unknown;
}

const RawTable = Schema.Record(Schema.String, Schema.Unknown);
const KNOWN_KEYS = new Set(Object.keys(okfitConfigFields.fields).filter((key) => key !== "extensions"));

// Record<string, unknown> <-> struct, partitioning unknown top-level keys into
// `extensions` (package-json internal/wire.ts precedent; contract deviation 4).
const OkfitConfigWire = RawTable.pipe(
	Schema.decodeTo(
		okfitConfigFields,
		SchemaTransformation.transform({
			decode: (raw: RawTable): OkfitConfigEncoded => {
				const known: Record<string, unknown> = {};
				// Null prototype: `extensions["__proto__"] = v` on a plain object would
				// reassign the prototype instead of storing the key.
				const extensions: Record<string, unknown> = Object.create(null);
				for (const [key, value] of Object.entries(raw)) {
					if (KNOWN_KEYS.has(key)) known[key] = value;
					else extensions[key] = value;
				}
				return { ...known, extensions } as unknown as OkfitConfigEncoded;
			},
			encode: (encoded: OkfitConfigEncoded): RawTable => {
				const { extensions, ...known } = encoded;
				// Typed fields win a collision: `extensions` can never shadow a known key.
				return { ...extensions, ...known };
			},
		}),
	),
) as unknown as Schema.Codec<OkfitConfig, Record<string, unknown>>;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

const define = (target: Record<string, unknown>, key: string, value: unknown): void => {
	Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
};

// deepMerge.ts semantics (config-file 0.5.2): plain objects merge key-wise,
// everything else is atomic and `override` wins. Fresh result, inputs untouched.
const mergeRecords = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(base)) {
		if (!FORBIDDEN_KEYS.has(key)) define(result, key, base[key]);
	}
	for (const key of Object.keys(override)) {
		if (FORBIDDEN_KEYS.has(key)) continue;
		const incoming = override[key];
		const current = result[key];
		if (Object.hasOwn(result, key) && isPlainObject(current) && isPlainObject(incoming)) {
			define(result, key, mergeRecords(current, incoming));
		} else {
			define(result, key, incoming);
		}
	}
	return result;
};

const merge = (base: OkfitConfig, override: OkfitConfig): OkfitConfig =>
	mergeRecords(base as Record<string, unknown>, override as Record<string, unknown>) as OkfitConfig;

const LINT_KEY: Record<LintCode, LintTableKey> = {
	"broken-links": "broken_links",
	"missing-index": "missing_index",
	"unknown-type": "unknown_type",
	"required-key-missing": "required_key_missing",
	"field-value-unknown": "field_value_unknown",
	"require-verified-unmet": "require_verified_unmet",
	"family-invalid": "family_invalid",
	"computation-runtime-missing": "computation_runtime_missing",
	"footnote-source-unknown": "footnote_source_unknown",
	"log-frontmatter": "log_frontmatter",
	"actor-prefix-unknown": "actor_prefix_unknown",
	"legacy-timestamp": "legacy_timestamp",
	"config-unknown-key": "config_unknown_key",
	stale: "stale",
	"walk-unreadable": "walk_unreadable",
	"generated-at-drift": "generated_at_drift",
};

// D-34 defaults, keyed by the [lint] table spelling.
const DEFAULT_LINT: Required<typeof LintTable.Type> = {
	broken_links: "warn",
	missing_index: "warn",
	unknown_type: "error",
	required_key_missing: "error",
	field_value_unknown: "error",
	require_verified_unmet: "error",
	family_invalid: "error",
	computation_runtime_missing: "error",
	footnote_source_unknown: "warn",
	log_frontmatter: "warn",
	actor_prefix_unknown: "info",
	legacy_timestamp: "info",
	config_unknown_key: "warn",
	stale: "info",
	walk_unreadable: "warn",
	generated_at_drift: "warn",
};

const toSeverity = (level: LintLevel): DiagnosticSeverity | "off" => (level === "warn" ? "warning" : level);

const severityFor = (config: OkfitConfig, code: LintCode): DiagnosticSeverity | "off" => {
	if (code === "unknown-type" && Object.keys(config.types ?? {}).length === 0) return "off";
	const key = LINT_KEY[code];
	return toSeverity(config.lint?.[key] ?? DEFAULT_LINT[key]);
};

/** Recursively freezes plain objects and arrays in place; leaves other values (class instances) untouched. */
const deepFreeze = <A>(value: A): A => {
	if (Array.isArray(value)) {
		for (const item of value) deepFreeze(item);
		return Object.freeze(value);
	}
	if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
		for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
		return Object.freeze(value);
	}
	return value;
};

const DEFAULTS: OkfitConfig = deepFreeze({
	okf_version: "0.2",
	bundle: { path: "okf", profile: "software-project" },
	concepts: { required: [], tags: { required: [] } },
	lifecycle: { default_stale_after: Duration.days(90) },
	actors: { humans: [] },
	lint: { ...DEFAULT_LINT },
	types: {},
	tags: {},
	extensions: {},
});

// One-shot read for tooling with a path in hand (D-29). ConfigFile.read needs
// FileSystem only (ConfigFile.ts:653-656); no parseOptions, the wire codec
// already preserves unknown keys (contract deviation 4).
const read = (path: string): Effect.Effect<OkfitConfig, ConfigReadError, FileSystem.FileSystem> =>
	ConfigFile.read(path, { schema: OkfitConfigWire, codec: TomlCodec }).pipe(
		Effect.withSpan("OkfitConfig.read", { attributes: { path } }),
	);

/**
 * The okfit config codec and its statics (spec 4.2, D-28 to D-31).
 *
 * @remarks
 * Decodes a parsed TOML table to a plain `OkfitConfig`, keeping unknown
 * top-level keys in `extensions`; encoding flattens them back so the on-disk
 * shape never carries a literal `extensions` key. `merge` is pure: plain
 * objects deep-merge, arrays and scalars in `override` replace wholesale. The
 * intended order is `DEFAULTS < profile < file`, applied by the caller (the
 * CLI resolves the profile; core cannot import `@okfit/profiles`).
 *
 * @public
 */
export const OkfitConfig: Schema.Codec<OkfitConfig, Record<string, unknown>> & {
	readonly fields: OkfitConfigFields;
	readonly DEFAULTS: OkfitConfig;
	readonly merge: (base: OkfitConfig, override: OkfitConfig) => OkfitConfig;
	readonly severityFor: (config: OkfitConfig, code: LintCode) => DiagnosticSeverity | "off";
	readonly read: (path: string) => Effect.Effect<OkfitConfig, ConfigReadError, FileSystem.FileSystem>;
} = Object.assign(OkfitConfigWire, { fields: okfitConfigFields.fields, DEFAULTS, merge, severityFor, read });

/**
 * The only service in core: the config-file service tag for okfit's TOML
 * config (D-7). Core exports the tag so `@okfit/cli` and `@okfit/mcp` share
 * one identity; the layer (`ConfigFile.layer` with the spec 4.1 resolvers and
 * XDG fallback) is built by the CLI, never here (D-29).
 *
 * @remarks
 * Shape is `ConfigFileShape<OkfitConfig>`: `load`, `loadFrom`, `discover`,
 * `loadOrDefault`, `validate`, `write(value, path)` (used by `okfit init`), `save`, `update`.
 *
 * @public
 */
export class OkfitConfigFile extends ConfigFile.Service<OkfitConfigFile, OkfitConfig>()(
	"@okfit/core/OkfitConfigFile",
) {}
