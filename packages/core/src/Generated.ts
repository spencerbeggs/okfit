import { Schema } from "effect";
import { Actor } from "./Actor.js";
import { Timestamp } from "./Timestamp.js";

/**
 * Who last generated a concept's content, and when.
 * @public
 */
export class Generated extends Schema.Class<Generated>("Generated")({
	by: Actor,
	at: Schema.optionalKey(Timestamp),
	/**
	 * Legacy (pre-integrity) body digest, read only as a migration fallback and never
	 * written. Lenient on purpose: a malformed legacy value must never fail the
	 * `generated` family and drop `by`/`at`. `okfit sync` moves it to `integrity.generated.body`.
	 */
	body_sha256: Schema.optionalKey(Schema.String),
}) {
	/** The `by` used when a legacy v0.1 `timestamp` is folded into `generated.at` (D-15); v0.1 has no actor. */
	static readonly LEGACY_BY = "process:legacy-timestamp" as Actor;
}
