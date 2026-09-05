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
	 * Bare mapping or list in; always a list out on decode AND encode (D-17). Not
	 * `Schema.ArrayEnsure`: its encode collapses a one-element list to a mapping (`Schema.ts:4708-4710`).
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
