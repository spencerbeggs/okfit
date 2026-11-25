/**
 * The JSON error envelope for a parse-time usage error (okfit #485).
 *
 * @packageDocumentation
 */

import type { Distribution } from "@effected/kit";
import type { JsonErrorEnvelope } from "@okfit/engine";
import { ENGINE_VERSION } from "@okfit/engine";

/**
 * True when the raw arguments ask for JSON output: a `--format json` pair or a
 * `--format=json` token before any `--`.
 *
 * @internal
 */
export const wantsJson = (argv: ReadonlyArray<string>): boolean => {
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === "--") return false;
		if (token === "--format=json") return true;
		if (token === "--format" && argv[i + 1] === "json") return true;
	}
	return false;
};

/**
 * The envelope for a usage error: `exit_code` 64, `error.tag` the first
 * error's `_tag`, `error.message` every message joined with `; `.
 *
 * @internal
 */
export const usageEnvelope = (
	errors: ReadonlyArray<{ readonly _tag: string; readonly message: string }>,
	okfitVersion: string,
	distribution?: Distribution,
): JsonErrorEnvelope => ({
	schema: 1,
	okfit_version: okfitVersion,
	engine_version: ENGINE_VERSION,
	distribution: distribution ?? null,
	exit_code: 64,
	error: { tag: errors[0]?._tag ?? "ShowHelp", message: errors.map((e) => e.message).join("; ") },
});
