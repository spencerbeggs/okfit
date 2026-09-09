---
"@okfit/cli": minor
---

## Breaking Changes

### Public API surface narrowed to the CLI's own surface

`@okfit/cli`'s barrel (`@okfit/cli`) no longer re-exports `@okfit/engine`'s public surface. `@okfit/cli` is now a presentation shell: commands, human renderers, `renderFailure`, and the bin/main wiring. The platform layer, config discovery, and the validate/verify/sync/init/context programs moved to `@okfit/engine` in a prior release; this release removes the compatibility re-export, so those symbols moved rather than disappeared.

The following are no longer exported from `@okfit/cli` — import them from `@okfit/engine` instead:

* Types: `ContextResult`, `ContextRunOptions`, `DiagnosticSource`, `DiscoveredConfig`, `RenderedDiagnostic`, `ResolveProjectConfigInput`, `ResolvedProjectConfig`, `RunOptions`, `RunResult`, `ScaffoldFile`, `ScaffoldOptions`, `Tally`
* Values: `CONFIG_RELATIVE_PATH`, `ConfigMalformedError`, `ConfigPathNotFoundError`, `ContextEnvelope`, `ContextTag`, `ContextType`, `DEFAULT_PROFILE_NAME`, `InitOverwriteError`, `JsonDiagnostic`, `JsonEnvelope`, `JsonErrorEnvelope`, `JsonSummary`, `VerifyConceptNotFoundError`, `VerifyEnvelope`, `VerifyUnsupportedFrontmatterError`, `buildConfigLayer`, `collect`, `configValue`, `contextEnvelope`, `files`, `forDiagnostics`, `json`, `jsonError`, `provideConfig`, `resolveBundleRoot`, `resolveProjectConfig`, `resolveProjectRoot`, `run`, `runContext`, `sort`, `tally`, `targetPaths`, `verifyEnvelope`
* The re-exported `ConfigReadError` type (originally from `@effected/config-file`) is also dropped; it was never part of `renderFailure`'s public contract.

Everything else — `rootCommand`, `renderFailure`, `humanContext`, `human`, `line`, `summary`, the `Counts` type, `VerifyLines`, `humanVerify`, `CLI_VERSION` — is unchanged and stays defined in `@okfit/cli`.

`@okfit/cli`'s `./main` export condition (`src/main.ts`, the assembled program) is also now supported public surface — it is what `@okfit/plugin`'s bin shims import.
