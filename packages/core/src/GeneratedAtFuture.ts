import { DateTime, Duration, Option } from "effect";

/**
 * How far past now a `generated.at` may sit before okfit treats it as a future stamp: five minutes, the allowance for
 * ordinary clock skew between machines. The lint `generated-at-future` and the repair in `okfit sync` both read it
 * through {@link generatedAtIsFuture}.
 *
 * @public
 */
export const GENERATED_AT_TOLERANCE: Duration.Duration = Duration.minutes(5);

/**
 * {@link GENERATED_AT_TOLERANCE} in words ("5 minutes"), for messages. Derived from the constant, so changing the
 * tolerance changes every message that names it. The tolerance is a whole number of minutes.
 *
 * @public
 */
export const GENERATED_AT_TOLERANCE_TEXT: string = (() => {
	const minutes = Duration.toMinutes(GENERATED_AT_TOLERANCE);
	return `${minutes} minute${minutes === 1 ? "" : "s"}`;
})();

/**
 * Whether `generatedAt` is more than {@link GENERATED_AT_TOLERANCE} later than `now`. Exactly the tolerance is not
 * future; one millisecond more is.
 *
 * @public
 */
export const generatedAtIsFuture = (generatedAt: DateTime.Utc, now: DateTime.Utc): boolean =>
	DateTime.isGreaterThan(generatedAt, DateTime.addDuration(now, GENERATED_AT_TOLERANCE));

/**
 * The earliest verification time `V` with `startOf(now, "second") <= V < generatedAt`, the verifications that
 * re-stamping `generatedAt` down to now would turn from not current into current (OKF 0.3 §5.3). `okfit sync` skips
 * such a re-stamp; the lint `generated-at-future` names the verification instead of promising the repair. `now` is
 * truncated to the whole second because stamps are written in whole seconds. None when no verification falls in the
 * window.
 *
 * @public
 */
export const verificationBlockingRestamp = (
	verifiedAts: ReadonlyArray<DateTime.Utc>,
	generatedAt: DateTime.Utc,
	now: DateTime.Utc,
): Option.Option<DateTime.Utc> => {
	const from = DateTime.startOf(now, "second");
	return verifiedAts
		.filter((at) => !DateTime.isLessThan(at, from) && DateTime.isLessThan(at, generatedAt))
		.reduce<Option.Option<DateTime.Utc>>(
			(earliest, at) =>
				Option.isSome(earliest) && !DateTime.isLessThan(at, earliest.value) ? earliest : Option.some(at),
			Option.none(),
		);
};
