import { changedWhileRead, readConfinedString } from "@okfit/core";
import { Effect } from "effect";
import { McpSchema } from "effect/ai";

/**
 * Read `absolutePath` under `bundleRoot` as a resource body, confined at the moment of reading (OKF 0.3 section 3.2),
 * failing as the `McpSchema.InternalError` a resource read answers with: `<label> links out of the bundle` for a link
 * that leaves the root or dangles, `"<label>" changed while it was read; try again` for a file that changed under the
 * read, and `unreadable` for any other failure of the open or the read.
 *
 * @internal
 */
export const readResourceText = (bundleRoot: string, absolutePath: string, label: string, unreadable: string) =>
	readConfinedString(bundleRoot, absolutePath).pipe(
		Effect.catchTag("ConfinementError", (error) =>
			Effect.fail(
				new McpSchema.InternalError({
					message: error.reason === "changed" ? changedWhileRead(label) : `${label} links out of the bundle`,
				}),
			),
		),
		Effect.catchTag("PlatformError", () => Effect.fail(new McpSchema.InternalError({ message: unreadable }))),
	);
