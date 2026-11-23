import type { DateTime } from "effect";
import { Schema, SchemaTransformation } from "effect";

// D-16. DateTimeUtcFromString appends "Z" to offset-less input (internal/dateTime.ts:229-232);
// spec 3.1's explicit-offset rule is enforced here (yaml-scalar-resolution-for-timestamps.md section 7).
const OFFSET_RE = /(?:Z|[+-]\d{2}:\d{2})$/u;

// OKF 0.3 section 5 (D8): a date-only value reads as the start of that day in UTC.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/u;

// `DateTimeUtcFromString` rolls an impossible date (2026-02-30) over to the next month, so the date-only
// form is re-read and must format back to the same day. (`Date.UTC` maps years 0-99 to 1900-1999, so
// those years are rejected, which is intended: no real timestamp is that old.)
const isCalendarDay = (value: string): boolean => {
	const [year, month, day] = value.split("-").map(Number) as [number, number, number];
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

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
 * A date-only `YYYY-MM-DD` value (OKF 0.3 section 5) reads as the start of that day in UTC; an impossible
 * calendar day fails. Offset-less date-times fail before parsing and are reported as `value-malformed`.
 * Encoding always writes a date-time: `2026-03-01T08:00:00Z` for a whole second, non-zero milliseconds kept.
 * @public
 */
export const Timestamp: Schema.Codec<DateTime.Utc, string> = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value: string) =>
				OFFSET_RE.test(value) ||
				(DATE_ONLY_RE.test(value) && isCalendarDay(value)) ||
				"Expected an ISO 8601 timestamp with an explicit offset (Z, +hh:mm or -hh:mm) or a calendar date (YYYY-MM-DD)",
		),
	),
	Schema.decodeTo(
		Schema.String,
		SchemaTransformation.transform({
			decode: (value: string) => (DATE_ONLY_RE.test(value) ? `${value}T00:00:00Z` : value),
			encode: (iso: string) => iso.replace(ZERO_MILLIS, ""),
		}),
	),
	Schema.decodeTo(Schema.DateTimeUtcFromString),
);
