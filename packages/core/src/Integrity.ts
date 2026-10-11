import { Schema } from "effect";
import { Actor } from "./Actor.js";
import { Timestamp } from "./Timestamp.js";

const DIGEST_RE = /^[0-9a-f]{16}$/u;

/**
 * An okfit digest: the first 16 lowercase hex characters (64 bits) of SHA-256 over the
 * input bytes `@okfit/profiles` defines. A signal, not a tamper seal. Core holds the
 * shape and never computes one.
 * @public
 */
export const Digest = Schema.String.pipe(
	Schema.check(Schema.isPattern(DIGEST_RE, { message: "Expected a lowercase 16-character hex digest" })),
);
/**
 * The type of {@link (Digest:variable)}.
 * @public
 */
export type Digest = typeof Digest.Type;

/**
 * The body digest as of `generated.at`.
 * @public
 */
export class IntegrityGenerated extends Schema.Class<IntegrityGenerated>("IntegrityGenerated")({
	body: Digest,
}) {}

/**
 * Binds one `human:` `verified` entry (joined on `by` and `at`) to the content it covered.
 * @public
 */
export class IntegrityVerified extends Schema.Class<IntegrityVerified>("IntegrityVerified")({
	by: Actor,
	at: Timestamp,
	content: Digest,
}) {}

/**
 * okfit's own top-level frontmatter family, the only place okfit stores digests
 * (OKF v0.2 section 4.1 extension key). Spec families such as `generated` and
 * `verified` stay exactly as the spec defines them.
 * @public
 */
export class Integrity extends Schema.Class<Integrity>("Integrity")({
	generated: Schema.optionalKey(IntegrityGenerated),
	verified: Schema.optionalKey(IntegrityVerified),
}) {}
