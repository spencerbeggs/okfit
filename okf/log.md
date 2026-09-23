# Log

## 2026-09-23

* Updated An @okfit/lsp language server and a VS Code extension over the shared engine
* Updated Claude Code Plugin
* Added LSP
* Updated Plugin
* Added The language server runs the reference vscode-languageserver library behind an Effect transport seam
* Updated Workspace
* Added The phase 3 language server does not reload a changed config or clear a dropped session's diagnostics
* Updated Claude Code plugin hooks contract
* Updated Core
* Updated Engine
* Updated Profiles
* Added The PostToolUse hook keeps only conformance blocking and the generated.by check, once the language server delivers lint and profile findings
* Added Two narrow interrupt windows in the LSP session registry are documented, not closed
* Added Publish the VS Code extension
* Added The VS Code extension lives at vscode/, not under plugins/ or packages/
* Added VS Code Extension

## 2026-09-22

* Updated okfit CLI — validate, init, context, verify, sync, lint, graph, stale
* Updated okfit-mcp — MCP tool and resource contract
* Updated An @okfit/lsp language server and a VS Code extension over the shared engine
* Updated Engine
* Added Ghost workspace
* Updated Workspace
* Added scratchpad

## 2026-09-20

* Updated MCP
* Added The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first
* Updated okfit-mcp — MCP tool and resource contract

## 2026-09-16

* Updated CLI
* Updated Engine
* Updated MCP
* Updated Plugin
* Updated okfit CLI — validate, init, context, verify, sync, lint, graph, stale
* Updated okfit-mcp — MCP tool and resource contract
* Updated Core
* Added The engine version, not the producer version, is what a report is compared on
* Updated okfit config file schema
* Added okfit sync's log mode appends into the newest logged day and dedupes on its own spellings
* Added okfit sync --staged stamps the git index with now, the one place a wall-clock stamp is honest

## 2026-09-15

* Updated okfit config file schema

## 2026-09-14

* Added The software-project vocabulary grows a third time from the silk action migrations

## 2026-09-13

* Added The software-project vocabulary grows from what migrations could not express

## 2026-09-12

* Updated okfit config file schema

## 2026-09-09

* Added A shared @okfit/engine package replaces cli-as-copy-contract
* Updated CLI
* Added Engine
* Updated MCP
* Updated Plugin

## 2026-09-08

* Updated A walk past maxDepth fails typed, never silently truncates
* Updated Config discovery follows the config-dir convention
* Added Config discovery is assembled through AppConfig.layer, not a hand-rolled resolver chain

## 2026-09-07

* Shipped okfit verify: a human-run command that appends a verified attestation by textual splice.
* Moved config discovery to the config-dir convention and published a SchemaStore-compatible JSON Schema for okfit.toml.

## 2026-09-06

* Initialized the bundle with the software-project profile
* Implemented the MCP server: six read-only tools, static concept resources, replacing the phase-1 stub.
