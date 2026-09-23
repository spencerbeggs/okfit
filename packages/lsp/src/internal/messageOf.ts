/**
 * Shared error-to-string helper for the log lines in `features/diagnostics.ts`
 * and `session/registry.ts`. Not part of the public surface.
 *
 * @internal
 */

/** The error's `message` when it has one as a string, else `String(error)`. */
export const messageOf = (error: unknown): string => {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { readonly message: unknown }).message;
		if (typeof message === "string") return message;
	}
	return String(error);
};
