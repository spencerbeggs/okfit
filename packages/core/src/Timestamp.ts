import type { DateTime } from "effect";
import { Function as Fn, Schema, SchemaTransformation } from "effect";

// D-16. DateTimeUtcFromString appends "Z" to offset-less input (internal/dateTime.ts:229-232);
// spec 3.1's explicit-offset rule is enforced here (yaml-scalar-resolution-for-timestamps.md section 7).
const OFFSET_RE = /(?:Z|[+-]\d{2}:\d{2})$/;

// P-18 (profiles decisions.md). `DateTimeUtcFromString` encodes with `DateTime.formatIso`, which always
// writes milliseconds ("...T08:00:00.000Z"). Git and the OKF sample bundles write whole seconds
// ("...T08:00:00Z"), so a zero component is dropped on encode. Decoding is untouched.
const ZERO_MILLIS = /\.000(?=Z$)/;

/**
 * A decoded OKF timestamp: always a UTC instant.
 * @public
 */
export type Timestamp = DateTime.Utc;

/**
 * ISO 8601 string with an explicit offset (`Z`, `+hh:mm` or `-hh:mm`) to `DateTime.Utc`.
 * Offset-less input fails before parsing so its family surfaces as `family-invalid` (D-15/D-16).
 * Encoding writes `2026-03-01T08:00:00Z` for a whole second and keeps non-zero milliseconds.
 * @public
 */
export const Timestamp: Schema.Codec<DateTime.Utc, string> = Schema.String.pipe(
	Schema.check(
		Schema.isPattern(OFFSET_RE, {
			message: "Expected an ISO 8601 timestamp with an explicit offset (Z, +hh:mm or -hh:mm)",
		}),
	),
	Schema.decodeTo(
		Schema.String,
		SchemaTransformation.transform({
			decode: Fn.identity,
			encode: (iso: string) => iso.replace(ZERO_MILLIS, ""),
		}),
	),
	Schema.decodeTo(Schema.DateTimeUtcFromString),
);
