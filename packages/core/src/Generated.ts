import { Schema } from "effect";
import { Actor } from "./Actor.js";
import { Timestamp } from "./Timestamp.js";

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * A lowercase 64-character hex sha256 digest of a concept's body, as `@okfit/profiles`'
 * `Derivation.bodyDigest` computes it (issue #19). Optional: every concept stamped before
 * this field existed lacks it, and core itself never computes one -- it only holds the field.
 * @public
 */
export const BodySha256 = Schema.String.pipe(
	Schema.check(Schema.isPattern(SHA256_HEX_RE, { message: "Expected a lowercase 64-character hex sha256 digest" })),
);

/**
 * The type of {@link (BodySha256:variable)}.
 * @public
 */
export type BodySha256 = typeof BodySha256.Type;

/**
 * Who last generated a concept's content, and when.
 * @public
 */
export class Generated extends Schema.Class<Generated>("Generated")({
	by: Actor,
	at: Schema.optionalKey(Timestamp),
	body_sha256: Schema.optionalKey(BodySha256),
}) {
	/** The `by` used when a legacy v0.1 `timestamp` is folded into `generated.at` (D-15); v0.1 has no actor. */
	static readonly LEGACY_BY = "process:legacy-timestamp" as Actor;
}
