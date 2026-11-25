import { DateTime, Duration } from "effect";

/**
 * How far past now a `generated.at` may sit before okfit treats it as a future stamp: five minutes, the allowance for
 * ordinary clock skew between machines. The lint `generated-at-future` and the repair in `okfit sync` both read it
 * through {@link generatedAtIsFuture}.
 *
 * @public
 */
export const GENERATED_AT_TOLERANCE: Duration.Duration = Duration.minutes(5);

/**
 * Whether `generatedAt` is more than {@link GENERATED_AT_TOLERANCE} later than `now`. Exactly the tolerance is not
 * future; one millisecond more is.
 *
 * @public
 */
export const generatedAtIsFuture = (generatedAt: DateTime.Utc, now: DateTime.Utc): boolean =>
	DateTime.isGreaterThan(generatedAt, DateTime.addDuration(now, GENERATED_AT_TOLERANCE));
