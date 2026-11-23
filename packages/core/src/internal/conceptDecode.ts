// Stage-1 envelope + stage-2 per-family decode of a concept's frontmatter value (D-15 to D-20).
// Pure: no filesystem, no positions. `internal/frontmatter.ts` turns the issues into Diagnostics.
// Private implementation module; never re-exported from `index.ts`.

import { Result, Schema, SchemaIssue } from "effect";
import {
	AttestedComputation,
	ComputationAttester,
	ComputationExecutor,
	ComputationParameter,
} from "../AttestedComputation.js";
import type { EntryFamily } from "../Concept.js";
import { ATTESTED_COMPUTATION_TYPE, Concept, EntryPaths } from "../Concept.js";
import { Generated } from "../Generated.js";
import { Integrity } from "../Integrity.js";
import { Source, UsageWindow } from "../Source.js";
import { Status } from "../Status.js";
import { Timestamp } from "../Timestamp.js";
import { Verification } from "../Verification.js";

/** One decode-time finding about a family; codes are lint codes with D-34 default severities.
 * @public
 */
export interface FamilyIssue {
	readonly code:
		| "family-invalid"
		| "entry-ignored"
		| "value-malformed"
		| "value-unknown"
		| "legacy-timestamp"
		| "computation-runtime-missing";
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
type YamlPath = ReadonlyArray<string | number>;

/** Scalar families: decoded whole through their schema; a failure reads as absent with `value-malformed`. */
const SCALAR_SCHEMAS = {
	title: Schema.String,
	description: Schema.String,
	resource: Schema.String,
	stale_after: Timestamp,
	superseded_by: Schema.String,
} as const;

const PARSE_OPTIONS = { errors: "all" } as const;
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

const isMapping = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * OKF 0.3 11.2 rule 1: `null`, an empty string and an empty list read as absent.
 *
 * @internal
 */
export const isAbsent = (value: unknown): boolean =>
	value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

const leafMessages = (failure: {
	readonly issue: SchemaIssue.Issue;
}): ReadonlyArray<{
	readonly path: YamlPath;
	readonly message: string;
}> =>
	formatIssue(failure.issue).issues.map((leaf) => ({
		path: (leaf.path ?? []).filter((segment): segment is string | number => typeof segment !== "symbol"),
		message: leaf.message,
	}));

/** Decode a whole family through one schema, reporting every leaf under `prefix` with `code`. */
const decodeFamily = <S extends Schema.ConstraintDecoder<unknown>>(
	schema: S,
	family: string,
	prefix: YamlPath,
	value: unknown,
	issues: Array<FamilyIssue>,
	code: "family-invalid" | "value-malformed" = "value-malformed",
): S["Type"] | undefined => {
	const result = Schema.decodeUnknownResult(schema, PARSE_OPTIONS)(value);
	if (Result.isSuccess(result)) return result.success;
	for (const leaf of leafMessages(result.failure)) {
		issues.push({ code, family, path: [...prefix, ...leaf.path], message: leaf.message });
	}
	return undefined;
};

/**
 * Decode a mapping key by key against a class's declared fields (OKF 0.3 11.2 rule 3). Each
 * declared key is decoded alone: a REQUIRED key that is missing or unreadable ignores the whole
 * mapping (`entry-ignored`, returns `undefined`); any other key that is unreadable is dropped
 * alone (`value-malformed` at `[...path, key]`). Keys the class does not declare are never read.
 *
 * @internal
 */
export const decodeMapping = (
	fields: Schema.Struct.Fields,
	required: ReadonlyArray<string>,
	value: unknown,
	path: YamlPath,
	family: string,
	issues: Array<FamilyIssue>,
): Record<string, unknown> | undefined => {
	if (!isMapping(value)) {
		issues.push({
			code: required.length > 0 ? "entry-ignored" : "value-malformed",
			family,
			path,
			message: "expected a mapping",
		});
		return undefined;
	}
	const out: Record<string, unknown> = {};
	const dropped: Array<FamilyIssue> = [];
	for (const key of Object.keys(fields)) {
		const isRequired = required.includes(key);
		const present = Object.hasOwn(value, key) && !isAbsent(value[key]);
		const ignore = (message: string): undefined => {
			issues.push({ code: "entry-ignored", family, path, message });
			return undefined;
		};
		if (isRequired && !present) return ignore(`\`${key}\` is required`);
		const schema = Schema.Struct({
			[key]: fields[key] as Schema.Struct.Fields[string],
		}) as unknown as Schema.Decoder<unknown>;
		const result = Schema.decodeUnknownResult(schema, PARSE_OPTIONS)(present ? { [key]: value[key] } : {});
		if (Result.isSuccess(result)) {
			const decoded = result.success as Record<string, unknown>;
			if (Object.hasOwn(decoded, key)) out[key] = decoded[key];
			continue;
		}
		if (!present) continue;
		const message = leafMessages(result.failure)[0]?.message ?? "unreadable";
		if (isRequired) return ignore(`\`${key}\` is unreadable: ${message}`);
		dropped.push({ code: "value-malformed", family, path: [...path, key], message });
	}
	issues.push(...dropped);
	return out;
};

/** A list family's items (rule 2: a non-list is a list of one) and each item's YAML path. */
const itemsOf = (key: string, value: unknown): ReadonlyArray<{ readonly item: unknown; readonly path: YamlPath }> =>
	Array.isArray(value) ? value.map((item, index) => ({ item, path: [key, index] })) : [{ item: value, path: [key] }];

/** Decode a list family of mappings; returns the kept values with their YAML paths, or `undefined` when none survive. */
const decodeMappingList = <A>(
	key: string,
	family: string,
	value: unknown,
	fields: Schema.Struct.Fields,
	required: ReadonlyArray<string>,
	make: (decoded: Record<string, unknown>) => A,
	issues: Array<FamilyIssue>,
): { readonly values: ReadonlyArray<A>; readonly paths: ReadonlyArray<YamlPath> } | undefined => {
	const values: Array<A> = [];
	const paths: Array<YamlPath> = [];
	for (const { item, path } of itemsOf(key, value)) {
		const decoded = decodeMapping(fields, required, item, path, family, issues);
		if (decoded === undefined) continue;
		values.push(make(decoded));
		paths.push(path);
	}
	return values.length === 0 ? undefined : { values, paths };
};

/** Decode one single-mapping key; absent (rule 1) or unreadable reads as `undefined`. */
const decodeSingle = <A>(
	key: string,
	family: string,
	raw: Record<string, unknown>,
	fields: Schema.Struct.Fields,
	required: ReadonlyArray<string>,
	make: (decoded: Record<string, unknown>) => A,
	issues: Array<FamilyIssue>,
): A | undefined => {
	if (isAbsent(raw[key])) return undefined;
	const decoded = decodeMapping(fields, required, raw[key], [key], family, issues);
	return decoded === undefined ? undefined : make(decoded);
};

/** Decode the computation keys independently (a bad `executor` no longer drops `runtime`). */
const decodeAttested = (
	raw: Record<string, unknown>,
	issues: Array<FamilyIssue>,
	entries: Partial<Record<EntryFamily, ReadonlyArray<YamlPath>>>,
): AttestedComputation => {
	const input: Record<string, unknown> = { parameters: [] };
	for (const key of ["runtime", "computation"] as const) {
		if (isAbsent(raw[key])) continue;
		const decoded = decodeFamily(Schema.String, "attested", [key], raw[key], issues);
		if (decoded !== undefined) input[key] = decoded;
	}
	if (!isAbsent(raw.parameters)) {
		const list = decodeMappingList(
			"parameters",
			"attested",
			raw.parameters,
			ComputationParameter.fields,
			["name", "type"],
			(decoded) => ComputationParameter.make(decoded as Parameters<typeof ComputationParameter.make>[0]),
			issues,
		);
		if (list !== undefined) {
			input.parameters = list.values;
			entries.parameters = list.paths;
		}
	}
	const executor = decodeSingle(
		"executor",
		"attested",
		raw,
		ComputationExecutor.fields,
		[],
		(decoded) => ComputationExecutor.make(decoded as Parameters<typeof ComputationExecutor.make>[0]),
		issues,
	);
	if (executor !== undefined) input.executor = executor;
	const attester = decodeSingle(
		"attester",
		"attested",
		raw,
		ComputationAttester.fields,
		[],
		(decoded) => ComputationAttester.make(decoded as Parameters<typeof ComputationAttester.make>[0]),
		issues,
	);
	if (attester !== undefined) input.attester = attester;
	return AttestedComputation.make(input as ConstructorParameters<typeof AttestedComputation>[0]);
};

/**
 * Decode a frontmatter value into a `Concept` without ever rejecting it for a
 * bad family. `TypeMissing` is the only failure (conformance `type-missing`). Reading is
 * tolerant, key by key (OKF 0.3 11.2 rules 1-4); only okfit's own `integrity`
 * family keeps the whole-family `family-invalid` decode.
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
	const known = new Set<string>([
		"type",
		...Object.keys(SCALAR_SCHEMAS),
		"status",
		"tags",
		"sources",
		"usage_window",
		"generated",
		"verified",
		"integrity",
		...(isComputation ? COMPUTATION_KEYS : []),
	]);
	const extensions = Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)));
	const fields: FamilyFields = { type, extensions, raw };
	const out = fields as Record<string, unknown>;
	const entries: Partial<Record<EntryFamily, ReadonlyArray<YamlPath>>> = {};
	const present = (key: string): boolean => key in raw && !isAbsent(raw[key]);
	const scalar = (key: keyof typeof SCALAR_SCHEMAS): void => {
		if (!present(key)) return;
		const decoded = decodeFamily(SCALAR_SCHEMAS[key], key, [key], raw[key], issues);
		if (decoded !== undefined) out[key] = decoded;
	};

	// Family order is the issue order: title, description, resource, tags, sources, usage_window, generated, verified, status, stale_after, integrity.
	for (const key of ["title", "description", "resource"] as const) scalar(key);

	if (present("tags")) {
		const kept: Array<string> = [];
		const paths: Array<YamlPath> = [];
		for (const { item, path } of itemsOf("tags", raw.tags)) {
			if (typeof item !== "string") {
				issues.push({ code: "value-malformed", family: "tags", path, message: "expected a string" });
				continue;
			}
			kept.push(item);
			paths.push(path);
		}
		if (kept.length > 0) {
			out.tags = kept;
			entries.tags = paths;
		}
	}

	if (present("sources")) {
		const list = decodeMappingList(
			"sources",
			"sources",
			raw.sources,
			Source.fields,
			["resource"],
			(decoded) => Source.make(decoded as Parameters<typeof Source.make>[0]),
			issues,
		);
		if (list !== undefined) {
			out.sources = list.values;
			entries.sources = list.paths;
		}
	}

	const usageWindow = decodeSingle(
		"usage_window",
		"usage_window",
		raw,
		UsageWindow.fields,
		[],
		(decoded) => UsageWindow.make(decoded as Parameters<typeof UsageWindow.make>[0]),
		issues,
	);
	if (usageWindow !== undefined) out.usage_window = usageWindow;

	const generated = decodeSingle(
		"generated",
		"generated",
		raw,
		Generated.fields,
		["by"],
		(decoded) => Generated.make(decoded as Parameters<typeof Generated.make>[0]),
		issues,
	);
	if (generated !== undefined) out.generated = generated;

	if (present("verified")) {
		const list = decodeMappingList(
			"verified",
			"verified",
			raw.verified,
			Verification.fields,
			["by", "at"],
			(decoded) => Verification.make(decoded as Parameters<typeof Verification.make>[0]),
			issues,
		);
		if (list !== undefined) {
			out.verified = list.values;
			entries.verified = list.paths;
		}
	}

	if (present("status")) {
		// OKF 0.3 11.2 rule 4: a value outside the vocabulary (or of the wrong type) is kept in `raw`, reported, never typed.
		if (Schema.is(Status)(raw.status)) out.status = raw.status;
		else {
			issues.push({
				code: "value-unknown",
				family: "status",
				path: ["status"],
				message: "expected draft, stable or deprecated",
			});
		}
	}
	scalar("stale_after");
	scalar("superseded_by");

	if (present("integrity")) {
		const integrity = decodeFamily(Integrity, "integrity", ["integrity"], raw.integrity, issues, "family-invalid");
		if (integrity !== undefined) out.integrity = integrity;
	}

	if (!("generated" in raw) && present("timestamp")) {
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
		fields.attested = decodeAttested(raw, issues, entries);
		if (fields.attested.runtime === undefined) {
			issues.push({
				code: "computation-runtime-missing",
				family: "attested",
				path: [],
				message: "`runtime` is required on an Attested Computation",
			});
		}
	}

	if (Object.keys(entries).length > 0) fields.entries = EntryPaths.make(entries);
	return { _tag: "Decoded", concept: Concept.make(fields as ConceptMakeInput), issues };
};
