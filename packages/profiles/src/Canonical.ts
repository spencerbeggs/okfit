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

const sortValue = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortValue);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.toSorted()
				.map((key) => [key, sortValue((value as Record<string, unknown>)[key])]),
		);
	}
	return value;
};

/** Canonical JSON: object keys sorted by code point at every depth; arrays keep their order. */
const json = (value: unknown): string => JSON.stringify(sortValue(value));

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
	/** Canonical JSON: sorted keys at every depth, array order kept. */
	static readonly json: (value: unknown) => string = json;
	/** The exact string a content digest hashes. */
	static readonly contentInput: (raw: Readonly<Record<string, unknown>>, source: string) => string = contentInput;
}
