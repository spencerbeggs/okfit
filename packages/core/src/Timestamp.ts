import type { DateTime } from "effect";
import { Schema } from "effect";

// D-16. DateTimeUtcFromString appends "Z" to offset-less input (internal/dateTime.ts:229-232);
// spec 3.1's explicit-offset rule is enforced here (yaml-scalar-resolution-for-timestamps.md section 7).
const OFFSET_RE = /(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * A decoded OKF timestamp: always a UTC instant.
 * @public
 */
export type Timestamp = DateTime.Utc;

/**
 * ISO 8601 string with an explicit offset (`Z`, `+hh:mm` or `-hh:mm`) to `DateTime.Utc`.
 * Offset-less input fails before parsing so its family surfaces as `family-invalid` (D-15/D-16).
 * @public
 */
export const Timestamp: Schema.Codec<DateTime.Utc, string> = Schema.String.pipe(
	Schema.check(
		Schema.isPattern(OFFSET_RE, {
			message: "Expected an ISO 8601 timestamp with an explicit offset (Z, +hh:mm or -hh:mm)",
		}),
	),
	Schema.decodeTo(Schema.DateTimeUtcFromString),
);
