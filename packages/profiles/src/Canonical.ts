import { body } from "./internal/body.js";

/** Top-level keys that are bookkeeping, not authored content (spec section 4). */
const EXCLUDED_KEYS: ReadonlySet<string> = new Set([
	"generated",
	"verified",
	"integrity",
	"stale_after",
	"status",
	"timestamp",
]);

/** `JSON.stringify` omits these in an object and writes `null` for them in an array. */
const isSkipped = (value: unknown): boolean =>
	value === undefined || typeof value === "function" || typeof value === "symbol";

/**
 * Canonical JSON: object keys sorted (`Array.prototype.toSorted`, UTF-16 code units)
 * at every depth; arrays keep their order. Byte-for-byte `JSON.stringify` of the
 * sorted value for every JSON-representable input, plus one extension: a `bigint`
 * (what the YAML decoder yields for an integer beyond 2^53, e.g. `ticket:
 * 123456789012345678901`) is written as its bare decimal literal. A literal cannot
 * collide with a string (strings are quoted) and is deterministic, where
 * `JSON.stringify` throws `TypeError` and would defect every caller that hashes.
 */
const json = (value: unknown): string => {
	if (typeof value === "bigint") return value.toString();
	if (Array.isArray(value)) return `[${value.map((item) => (isSkipped(item) ? "null" : json(item))).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (typeof record.toJSON === "function") return json((record.toJSON as () => unknown)());
		const members = Object.keys(record)
			.toSorted()
			.filter((key) => !isSkipped(record[key]))
			.map((key) => `${JSON.stringify(key)}:${json(record[key])}`);
		return `{${members.join(",")}}`;
	}
	return JSON.stringify(value);
};

const stripRendersDigests = (renders: unknown): unknown =>
	Array.isArray(renders)
		? renders.map((entry) => {
				if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;
				const { body: _body, body_sha256: _legacy, ...rest } = entry as Record<string, unknown>;
				return rest;
			})
		: renders;

/**
 * The exact string a content digest hashes: canonical JSON of the authored frontmatter
 * (`raw` minus `Canonical.EXCLUDED_KEYS` and every `renders[].body`) and the
 * normalised body. `raw` is the parsed mapping (YAML 1.2 Core Schema: timestamps are
 * strings), so quoting, flow vs block style, key order and CRLF never change it.
 */
const contentInput = (raw: Readonly<Record<string, unknown>>, source: string): string => {
	const frontmatter = Object.fromEntries(
		Object.entries(raw)
			.filter(([key]) => !EXCLUDED_KEYS.has(key))
			.map(([key, value]) => [key, key === "renders" ? stripRendersDigests(value) : value]),
	);
	return json({ body: body(source), frontmatter });
};

/**
 * Canonical encoding for okfit's content digest.
 *
 * @public
 */
export class Canonical {
	private constructor() {}
	/** Top-level frontmatter keys excluded from the content digest. */
	static readonly EXCLUDED_KEYS: ReadonlySet<string> = EXCLUDED_KEYS;
	/** Canonical JSON: sorted keys at every depth, array order kept; a `bigint` is its bare decimal literal. */
	static readonly json: (value: unknown) => string = json;
	/** The exact string a content digest hashes. */
	static readonly contentInput: (raw: Readonly<Record<string, unknown>>, source: string) => string = contentInput;
}
