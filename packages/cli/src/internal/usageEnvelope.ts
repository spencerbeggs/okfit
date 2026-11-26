/**
 * The JSON error envelope for a parse-time usage error (okfit #485).
 *
 * @packageDocumentation
 */

import type { Distribution } from "@effected/kit";
import type { JsonErrorEnvelope } from "@okfit/engine";
import { ENGINE_VERSION } from "@okfit/engine";

/**
 * True for the command path of `okfit graph`, the one command whose `--format`
 * is not the `Format` global setting.
 *
 * @internal
 */
export const isGraphPath = (commandPath: ReadonlyArray<string>): boolean =>
	commandPath.length === 2 && commandPath[0] === "okfit" && commandPath[1] === "graph";

/**
 * True when the raw arguments ask for JSON output: a `--format json` pair or a
 * `--format=json` token before any `--`.
 *
 * Graph-only: every other command reads `--format` through the `Format` setting
 * (`internal/format.ts`). It exists because effect 4.1.6's flag registry rejects
 * two global settings sharing a flag name, and goes once upstream allows
 * per-scope settings with one name.
 * TODO(spencerbeggs/effected#1435).
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
