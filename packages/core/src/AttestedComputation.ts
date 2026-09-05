import { Effect, Schema } from "effect";

/**
 * One declared input of an attested computation.
 * @public
 */
export class ComputationParameter extends Schema.Class<ComputationParameter>("ComputationParameter")({
	name: Schema.String,
	type: Schema.String,
	required: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
}) {}

/**
 * The skill that runs the computation and the receipt fields it must return.
 * @public
 */
export class ComputationExecutor extends Schema.Class<ComputationExecutor>("ComputationExecutor")({
	resource: Schema.String,
	receipt: Schema.Array(Schema.String),
}) {}

/**
 * The deterministic attester that checks an executor's receipt.
 * @public
 */
export class ComputationAttester extends Schema.Class<ComputationAttester>("ComputationAttester")({
	resource: Schema.String,
}) {}

/**
 * The `Attested Computation` family (D-20). `runtime` absent means lint
 * `computation-runtime-missing`; the concept still loads.
 * @public
 */
export class AttestedComputation extends Schema.Class<AttestedComputation>("AttestedComputation")({
	runtime: Schema.optionalKey(Schema.String),
	parameters: Schema.Array(ComputationParameter).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	computation: Schema.optionalKey(Schema.String),
	executor: Schema.optionalKey(ComputationExecutor),
	attester: Schema.optionalKey(ComputationAttester),
}) {}
