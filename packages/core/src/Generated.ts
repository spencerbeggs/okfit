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
}) {
	/** The `by` used when a legacy v0.1 `timestamp` is folded into `generated.at` (D-15); v0.1 has no actor. */
	static readonly LEGACY_BY = "process:legacy-timestamp" as Actor;
}
