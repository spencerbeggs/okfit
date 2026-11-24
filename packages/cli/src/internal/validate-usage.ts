import { Runtime, Schema } from "effect";

/**
 * `okfit validate` was given a flag combination or value it refuses: a `--target` other than the OKF version this
 * okfit implements, or `--fix`, `--only` or `--dry-run` without what they need. A usage error (exit 64).
 *
 * @public
 */
export class ValidateUsageError extends Schema.TaggedError<ValidateUsageError>()("ValidateUsageError", {
	reason: Schema.String,
}) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		return this.reason;
	}
}
