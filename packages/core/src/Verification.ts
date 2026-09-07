import { Array as Arr, Function as Fn, Schema, SchemaTransformation } from "effect";
import { Actor } from "./Actor.js";
import { Timestamp } from "./Timestamp.js";

/**
 * One verification attestation: who verified and when.
 * @public
 */
export class Verification extends Schema.Class<Verification>("Verification")({
	by: Actor,
	at: Timestamp,
}) {
	/**
	 * Bare mapping or list in; always a list out on decode AND encode (D-17):
	 * this transform's encode is `Fn.identity`, so a concept that arrived as a
	 * bare mapping is list-shaped on disk from the first re-encode onward. Not
	 * `Schema.ArrayEnsure`, whose encode returns the single element for a
	 * one-element array (`Schema.ts:4738-4746`) and would round-trip a
	 * one-entry list back to a bare mapping.
	 */
	static readonly List = Schema.Union([Verification, Schema.Array(Verification)]).pipe(
		Schema.decodeTo(
			Schema.Array(Schema.toType(Verification)),
			SchemaTransformation.transform({
				decode: Arr.ensure,
				encode: Fn.identity,
			}),
		),
	);
}
