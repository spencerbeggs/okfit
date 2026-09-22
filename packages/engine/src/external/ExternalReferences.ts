import { Context, Effect, Layer, Option, Schema } from "effect";

/**
 * Reachability of an external reference: `unknown` means never checked.
 *
 * @public
 */
export const ReferenceState = Schema.Literals(["ok", "unreachable", "unknown"]);

/**
 * One reachability answer. `checkedAt` is `None` when nothing was checked: the
 * engine never reads a Clock to invent a timestamp.
 *
 * @public
 */
export const ReferenceCheck = Schema.Struct({
	url: Schema.String,
	state: ReferenceState,
	checkedAt: Schema.Option(Schema.DateTimeUtc),
});
/** @public */
export type ReferenceCheck = typeof ReferenceCheck.Type;

/** @public */
export interface ExternalReferencesShape {
	readonly check: (url: string) => Effect.Effect<ReferenceCheck>;
}

/**
 * External-reference reachability (spec 4.4). Phase 2 ships only `layerNoop`;
 * phase 7 adds an HTTP layer over a store-backed cache.
 *
 * @public
 */
export class ExternalReferences extends Context.Service<ExternalReferences, ExternalReferencesShape>()(
	"@okfit/engine/ExternalReferences",
) {
	/** Answers `unknown`, never checked, for every url. */
	static readonly layerNoop: Layer.Layer<ExternalReferences> = Layer.succeed(ExternalReferences, {
		check: (url) => Effect.succeed(ReferenceCheck.make({ url, state: "unknown", checkedAt: Option.none() })),
	});
}
