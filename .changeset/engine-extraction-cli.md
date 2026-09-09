---
"@okfit/cli": minor
---

## Breaking Changes

### Public API surface moved to `@okfit/engine`

`@okfit/cli` is now a presentation shell: commands, human renderers, `renderFailure`, and the bin/main wiring. The platform layer, config discovery, and the validate/verify/sync/init/context programs moved to the new `@okfit/engine` package, which `@okfit/cli` now re-exports for compatibility.

If you imported any of the following from `@okfit/cli`, they are still exported from `@okfit/cli`'s barrel, but now originate in `@okfit/engine` — import from `@okfit/engine` directly if you don't otherwise need the CLI:

* Types: `ContextResult`, `ContextRunOptions`, `DiagnosticSource`, `DiscoveredConfig`, `RenderedDiagnostic`, `ResolveProjectConfigInput`, `ResolvedProjectConfig`, `RunOptions`, `RunResult`, `ScaffoldFile`, `ScaffoldOptions`, `Tally`
* Values: `CONFIG_RELATIVE_PATH`, `ConfigMalformedError`, `ConfigPathNotFoundError`, `ContextEnvelope`, `ContextTag`, `ContextType`, `DEFAULT_PROFILE_NAME`, `InitOverwriteError`, `JsonDiagnostic`, `JsonEnvelope`, `JsonErrorEnvelope`, `JsonSummary`, `VerifyConceptNotFoundError`, `VerifyEnvelope`, `VerifyUnsupportedFrontmatterError`, `buildConfigLayer`, `collect`, `configValue`, `contextEnvelope`, `files`, `forDiagnostics`, `json`, `jsonError`, `provideConfig`, `resolveBundleRoot`, `resolveProjectConfig`, `resolveProjectRoot`, `run`, `runContext`, `sort`, `tally`, `targetPaths`, `verifyEnvelope`

Everything else — `rootCommand`, `renderFailure`, `humanContext`, `human`, `line`, `summary`, the `Counts` type, `VerifyLines`, `humanVerify`, `CLI_VERSION`, and the re-exported `ConfigReadError` type — is unchanged and stays defined in `@okfit/cli`.

`@okfit/cli`'s own `process`-read allowlist is now narrower (`bin.ts`, `main.ts`, `commands/`, `internal/exit.ts`, `internal/tty.ts`, `version.ts`) since everything that moved to `@okfit/engine` carried its `process` access with it.
