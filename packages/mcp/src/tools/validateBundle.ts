import { Git } from "@effected/git";
import { AppDirs, Xdg } from "@effected/xdg";
import { OKF_SPEC_VERSION } from "@okfit/core";
import { JsonEnvelope, collect, forDiagnostics, json, run } from "@okfit/engine";
import { GitHistory } from "@okfit/profiles";
import { Crypto, Effect, FileSystem, Option, Path } from "effect";
import { Tool } from "effect/unstable/ai";
import { BundleNotFound, McpToolError, composeRemediatedMessage } from "../errors.js";
import { resolveNow } from "../internal/resolveNow.js";
import { resolveConfigOnly } from "../internal/toolContext.js";
import type { ValidateBundleParams } from "../schema/tools.js";
import { ValidateBundleParams as Params } from "../schema/tools.js";
import { MCP_VERSION } from "../version.js";

const DESCRIPTION =
	"Runs the same conformance and lint checks as `okfit validate --format json` and returns that report unchanged: every diagnostic's file, code, severity, message and range, plus the summary counts and the exit code the CLI would use. Call it after writing or editing any concept file, before moving on to the next one.";

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
 * (J-2): the field names the package that produced the report.
 *
 * @public
 */
export const handleValidateBundle = (projectRoot: string, params: ValidateBundleParams) =>
	Effect.gen(function* () {
		const resolved = yield* resolveConfigOnly(projectRoot);
		const now = yield* resolveNow(params.now);
		const result = yield* run({
			root: resolved.bundleRoot,
			config: resolved.config,
			profile: resolved.profile,
			now,
		}).pipe(
			Effect.mapError((cause) => {
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
			okfVersion: resolved.config.okf_version ?? OKF_SPEC_VERSION,
			root: resolved.bundleRoot,
			profile: Option.match(resolved.profile, { onNone: () => null, onSome: (profile) => profile.name }),
			exitCode: code,
			concepts: result.bundle.concepts.size,
			diagnostics,
		});
	});
