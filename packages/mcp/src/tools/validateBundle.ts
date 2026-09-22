import { Git } from "@effected/git";
import { AppDirs, Xdg } from "@effected/xdg";
import { OKF_SPEC_VERSION } from "@okfit/core";
import type { Distribution } from "@okfit/engine";
import { DocumentPathError, JsonEnvelope, collect, forDiagnostics, json, provideDocuments, run } from "@okfit/engine";
import { GitHistory } from "@okfit/profiles";
import { Crypto, Effect, FileSystem, Option, Path } from "effect";
import { Tool } from "effect/unstable/ai";
import { BundleNotFound, InvalidArgument, McpToolError, composeRemediatedMessage } from "../errors.js";
import { resolveNow } from "../internal/resolveNow.js";
import { resolveConfigOnly } from "../internal/toolContext.js";
import type { ValidateBundleParams } from "../schema/tools.js";
import { ValidateBundleParams as Params } from "../schema/tools.js";
import { MCP_VERSION } from "../version.js";

const DESCRIPTION =
	"Runs the same checks as `okfit validate --format json` and returns that report unchanged: each diagnostic's file, code, severity, message and range, the summary counts and the CLI's exit code. Call it after editing any concept file. Optional documents: [{ path, text }] (bundle-relative, e.g. metrics/churn.md) validates unsaved text in place of disk, new files included; nothing is written.";

/**
 * `dependencies` mirrors the other tools' (Task B1's Deviation 1):
 * `resolveConfigOnly` and `run()` need the same platform services, and
 * without a `dependencies` declaration `Tool.HandlerServices` infers
 * `never`, failing the handler record against `HandlersFrom` when passed to
 * `OkfitToolkit.toLayer`.
 *
 * `Git` and `GitHistory` are new in this list: B3 widened `run()`'s own
 * requirement channel to `FileSystem.FileSystem | Path.Path | Git |
 * GitHistory` so it can run `Provenance.lint`'s `generated-at-drift`
 * check (S-8, S-16). Both are provided by `server.ts`'s `ServerLayer`,
 * which needs only `ChildProcessSpawner` to build them — already
 * supplied by `@okfit/engine`'s `OkfitPlatform` (S-16). `Crypto` joined the
 * same channel for issue #19's body-digest tier of `Provenance.lint`, and
 * is provided the same way -- `OkfitPlatform`'s `NodeServices.layer` bundles
 * it alongside `FileSystem`/`Path`.
 *
 * @public
 */
export const validateBundle = Tool.make("validate_bundle", {
	description: DESCRIPTION,
	parameters: Params,
	success: JsonEnvelope,
	failure: McpToolError,
	dependencies: [FileSystem.FileSystem, Path.Path, AppDirs, Xdg, Git, GitHistory, Crypto.Crypto],
})
	.annotate(Tool.Title, "Validate the bundle")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * This tool does not call `loadToolContext`: `run()` calls `Bundle.load`
 * itself (`packages/engine/src/validate/run.ts:52-56`), so routing through
 * `loadToolContext` would load the bundle twice. It uses `resolveConfigOnly`
 * and keeps `bundleRoot`, `config` **and** `profile` — `run()` needs the
 * profile. `success` is `JsonEnvelope`, imported from `@okfit/engine` and used
 * verbatim (N-35's own carve-out: data reuse, not envelope reuse);
 * `JsonErrorEnvelope` is never returned — that is the CLI's stdout
 * convention for an exit-3 infrastructure failure, and here that failure is
 * a typed `McpToolError` instead, so `forDiagnostics`' `0 | 1 | 2` result is
 * always reachable. `okfitVersion` is `MCP_VERSION`, not `CLI_VERSION`
 * (J-2): the field names the package that produced the report, and
 * `producer` says which package that is so a reader comparing this report
 * with `okfit validate --format json` does not read the two versions as
 * drift (okfit #75). `distribution` is whatever `ServerLayer` was given
 * (okfit #137) -- `null` unless the launching bin came through
 * `@okfit/plugin`.
 *
 * @public
 */
export const handleValidateBundle = (projectRoot: string, params: ValidateBundleParams, distribution?: Distribution) =>
	Effect.gen(function* () {
		const resolved = yield* resolveConfigOnly(projectRoot);
		const now = yield* resolveNow(params.now);
		const result = yield* run({
			root: resolved.bundleRoot,
			config: resolved.config,
			profile: resolved.profile,
			now,
		}).pipe(
			provideDocuments(resolved.bundleRoot, params.documents ?? []),
			Effect.mapError((cause) => {
				if (cause instanceof DocumentPathError) {
					const remediation = {
						hint: "Give each document path relative to the bundle root, in posix form, naming a .md file once (for example metrics/churn.md).",
					};
					return new InvalidArgument({
						argument: "documents",
						message: composeRemediatedMessage(cause.message, remediation),
						remediation,
					});
				}
				const remediation = {
					hint: `The bundle root "${resolved.bundleRoot}" does not exist or could not be read; check the config's [bundle].path, or run \`okfit init\`.`,
				};
				return new BundleNotFound({
					root: resolved.bundleRoot,
					message: composeRemediatedMessage(cause.message, remediation),
					remediation,
				});
			}),
		);
		const diagnostics = collect(result.report.conformance, result.report.lint, result.profileDiagnostics);
		const code = forDiagnostics(diagnostics);
		return json({
			okfitVersion: MCP_VERSION,
			producer: "@okfit/mcp",
			okfVersion: resolved.config.okf_version ?? OKF_SPEC_VERSION,
			root: resolved.bundleRoot,
			profile: Option.match(resolved.profile, { onNone: () => null, onSome: (profile) => profile.name }),
			exitCode: code,
			concepts: result.bundle.concepts.size,
			diagnostics,
			// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
			...(distribution === undefined ? {} : { distribution }),
		});
	});
