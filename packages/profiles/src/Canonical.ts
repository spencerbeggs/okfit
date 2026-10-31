import { JsoncCanonicalizeOptions, JsoncFingerprint } from "@effected/jsonc";
import { Result, Schema } from "effect";
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

/**
 * `@effected/jsonc`'s RFC 8785 canonicalization, relaxed only where okfit's frontmatter needs it: a `bigint`
 * (what the YAML decoder yields for an integer beyond 2^53) is written as its bare decimal literal, an
 * `undefined` member is omitted, a non-finite number is `null`, and a `toJSON` value is serialized through
 * it. These match `JSON.stringify` of the sorted value byte for byte. An unpaired surrogate is NOT relaxed:
 * it is not well-formed Unicode, can only arrive through a YAML `\uD800`-style escape, and fails as a
 * {@link ContentUnhashableError} instead of being hashed (okfit#327).
 */
const CANONICALIZE = JsoncCanonicalizeOptions.make({
	bigint: "number",
	undefined: "omit",
	nonFinite: "null",
	toJSON: "all",
});

/**
 * A concept's content cannot be canonicalized for its digest, so it has none: most often a frontmatter
 * string holding an unpaired surrogate (`"\uD800"`). `path` is the offending value's frontmatter path
 * (`[]` for the frontmatter itself), `detail` the canonicalizer's reason.
 *
 * @public
 */
export class ContentUnhashableError extends Schema.TaggedError<ContentUnhashableError>()("ContentUnhashableError", {
	path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
	detail: Schema.String,
}) {
	override get message(): string {
		const where = this.path.length === 0 ? "the frontmatter" : this.path.join(".");
		return `${where} cannot be hashed: ${this.detail}`;
	}
}

/** `/frontmatter/a/0/b` to `["a", 0, "b"]` (RFC 6901 unescaping); a body or root pointer to `[]`. */
const frontmatterPath = (pointer: string): ReadonlyArray<string | number> => {
	const [, head, ...rest] = pointer.split("/");
	if (head !== "frontmatter") return [];
	return rest.map((token) => {
		const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
		return /^(0|[1-9][0-9]*)$/.test(key) ? Number(key) : key;
	});
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
 * The exact string a content digest hashes, or why there is none: canonical JSON of the authored frontmatter
 * (`raw` minus `Canonical.EXCLUDED_KEYS` and every `renders[].body`) and the
 * normalised body. `raw` is the parsed mapping (YAML 1.2 Core Schema: timestamps are
 * strings), so quoting, flow vs block style, key order and CRLF never change it.
 */
const contentInput = (
	raw: Readonly<Record<string, unknown>>,
	source: string,
): Result.Result<string, ContentUnhashableError> => {
	const frontmatter = Object.fromEntries(
		Object.entries(raw)
			.filter(([key]) => !EXCLUDED_KEYS.has(key))
			.map(([key, value]) => [key, key === "renders" ? stripRendersDigests(value) : value]),
	);
	return Result.mapError(
		JsoncFingerprint.canonicalizeResult({ body: body(source), frontmatter }, CANONICALIZE),
		(error) => new ContentUnhashableError({ path: frontmatterPath(error.path), detail: error.detail }),
	);
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
	/** The exact string a content digest hashes, or a {@link ContentUnhashableError}. */
	static readonly contentInput: (
		raw: Readonly<Record<string, unknown>>,
		source: string,
	) => Result.Result<string, ContentUnhashableError> = contentInput;
}
