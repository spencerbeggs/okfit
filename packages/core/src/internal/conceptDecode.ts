// Stage-1 envelope + stage-2 per-family decode of a concept's frontmatter value (D-15 to D-20).
// Pure: no filesystem, no positions. `internal/frontmatter.ts` turns the issues into Diagnostics.
// Private implementation module; never re-exported from `index.ts`.

import { Result, Schema, SchemaIssue } from "effect";
import { AttestedComputation } from "../AttestedComputation.js";
import { ATTESTED_COMPUTATION_TYPE, Concept } from "../Concept.js";
import { Generated } from "../Generated.js";
import { Source, UsageWindow } from "../Source.js";
import { Status } from "../Status.js";
import { Timestamp } from "../Timestamp.js";
import { Verification } from "../Verification.js";

/** One decode-time finding about a family; codes are lint codes with D-34 default severities.
 * @public
 */
export interface FamilyIssue {
	readonly code: "family-invalid" | "legacy-timestamp" | "computation-runtime-missing";
	readonly family: string;
	/** YAML path from the frontmatter root; `[]` means the whole block. */
	readonly path: ReadonlyArray<string | number>;
	readonly message: string;
}

/**
 * The result of decoding a frontmatter value into a `Concept`.
 * @public
 */
export type ConceptDecodeResult =
	| { readonly _tag: "TypeMissing"; readonly message: string }
	| { readonly _tag: "Decoded"; readonly concept: Concept; readonly issues: ReadonlyArray<FamilyIssue> };

/** Top-level keys that form the computation family when `type` is `Attested Computation`.
 * @public
 */
export const COMPUTATION_KEYS = ["runtime", "parameters", "computation", "executor", "attester"] as const;

type ConceptMakeInput = Parameters<typeof Concept.make>[0];
type FamilyFields = { -readonly [K in keyof ConceptMakeInput]?: ConceptMakeInput[K] };

const FAMILY_SCHEMAS = {
	title: Schema.String,
	description: Schema.String,
	resource: Schema.String,
	tags: Schema.Array(Schema.String),
	sources: Schema.Array(Source),
	usage_window: UsageWindow,
	generated: Generated,
	verified: Verification.List,
	status: Status,
	stale_after: Timestamp,
} as const;
type FamilyKey = keyof typeof FAMILY_SCHEMAS;

const FAMILY_KEYS = Object.keys(FAMILY_SCHEMAS) as ReadonlyArray<FamilyKey>;
const PARSE_OPTIONS = { errors: "all" } as const;
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

const isMapping = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const decodeFamily = <S extends Schema.ConstraintDecoder<unknown>>(
	schema: S,
	family: string,
	prefix: ReadonlyArray<string | number>,
	value: unknown,
	issues: Array<FamilyIssue>,
): S["Type"] | undefined => {
	const result = Schema.decodeUnknownResult(schema, PARSE_OPTIONS)(value);
	if (Result.isSuccess(result)) return result.success;
	for (const leaf of formatIssue(result.failure.issue).issues) {
		const leafPath = leaf.path ?? [];
		const path = [...prefix, ...leafPath.filter((segment): segment is string | number => typeof segment !== "symbol")];
		issues.push({ code: "family-invalid", family, path, message: leaf.message });
	}
	return undefined;
};

/**
 * Decode a frontmatter value into a `Concept` without ever rejecting it for a
 * bad family. `TypeMissing` is the only failure (conformance `type-missing`).
 * @public
 */
export const decodeConcept = (value: unknown): ConceptDecodeResult => {
	if (!isMapping(value)) return { _tag: "TypeMissing", message: "frontmatter is not a mapping" };
	const raw = Object.fromEntries(Object.entries(value));
	const type = raw.type;
	if (typeof type !== "string") return { _tag: "TypeMissing", message: "`type` must be a non-empty string" };
	if (type.length === 0) return { _tag: "TypeMissing", message: "`type` must not be empty" };

	const issues: Array<FamilyIssue> = [];
	const isComputation = type === ATTESTED_COMPUTATION_TYPE;
	const known = new Set<string>(["type", ...FAMILY_KEYS, ...(isComputation ? COMPUTATION_KEYS : [])]);
	const extensions = Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)));
	const fields: FamilyFields = { type, extensions, raw };

	for (const key of FAMILY_KEYS) {
		if (!(key in raw)) continue;
		const decoded = decodeFamily(FAMILY_SCHEMAS[key], key, [key], raw[key], issues);
		if (decoded !== undefined) (fields as Record<FamilyKey, unknown>)[key] = decoded;
	}

	if (!("generated" in raw) && "timestamp" in raw) {
		const at = decodeFamily(Timestamp, "timestamp", ["timestamp"], raw.timestamp, issues);
		if (at !== undefined) {
			fields.generated = Generated.make({ by: Generated.LEGACY_BY, at });
			issues.push({
				code: "legacy-timestamp",
				family: "timestamp",
				path: ["timestamp"],
				message: "legacy `timestamp` used as `generated.at`",
			});
		}
	}

	if (isComputation) {
		const picked = Object.fromEntries(COMPUTATION_KEYS.filter((key) => key in raw).map((key) => [key, raw[key]]));
		const attested = decodeFamily(AttestedComputation, "attested", [], picked, issues);
		if (attested !== undefined) fields.attested = attested;
		if (raw.runtime === undefined) {
			issues.push({
				code: "computation-runtime-missing",
				family: "attested",
				path: [],
				message: "`runtime` is required on an Attested Computation",
			});
		}
	}

	return { _tag: "Decoded", concept: Concept.make(fields as ConceptMakeInput), issues };
};
