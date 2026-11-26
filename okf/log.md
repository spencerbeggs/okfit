# Log

## 2026-11-26

* Updated A verification is bound to the content it covered
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale

## 2026-11-25

* Updated AI Plugins
* Updated Agent plugin hooks contract
* Updated CLI
* Updated Core
* Updated Engine
* Updated Markdown that is not a concept is skipped, not an error
* Updated Migration to a newer OKF version is a report on validate, with two safe fixes
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated okfit config file schema
* Updated A verification is bound to the content it covered
* Updated Every okfit digest lives in one integrity family, outside the spec's families
* Updated Generated.at is the author date of the last commit that changed the body
* Updated LSP
* Updated Repository resources are classified by where they resolve
* Updated okfit sync --staged stamps the git index with now, the one place a wall-clock stamp is honest
* Updated okfit's own frontmatter keys carry the x-okfit- prefix
* Updated stale --verify rolls stale_after forward, and plain verify never does
* Updated An unknown status is not current knowledge

## 2026-11-24

* Updated A cited file that other checkouts cannot see is a lint, split by whether it is ignored
* Added A deprecated concept's replacement is followed
* Added An unknown status is not current knowledge
* Updated CLI
* Updated Core
* Updated Engine
* Updated LSP
* Updated Loading never fails a concept for a bad family
* Updated MCP
* Updated Markdown that is not a concept is skipped, not an error
* Updated Profiles
* Added Repository resources are classified by where they resolve
* Updated The declared OKF version gates the v0.2 fallbacks
* Updated The root index's metadata is read and kept
* Updated VS Code Extension
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated okfit config file schema
* Updated okfit-mcp — MCP tool and resource contract
* Updated stale --verify rolls stale_after forward, and plain verify never does
* Updated A verification is bound to the content it covered
* Updated Every okfit digest lives in one integrity family, outside the spec's families
* Updated Verification drift is a signal to weigh, never a gate
* Updated integrity frontmatter family
* Updated Generated.at is the author date of the last commit that changed the body
* Updated okfit sync --staged stamps the git index with now, the one place a wall-clock stamp is honest
* Updated A shared @okfit/engine package replaces cli-as-copy-contract
* Updated The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first
* Updated The engine version, not the producer version, is what a report is compared on
* Updated The language and MCP servers survive a stray crash once serving, and exit on one before
* Updated okfit's front ends build on @effected/{engine,cli,mcp} rather than hand-rolled equivalents
* Updated AI Plugins
* Updated Agent plugin hooks contract
* Added Migration to a newer OKF version is a report on validate, with two safe fixes
* Updated The PostToolUse hook keeps only conformance blocking and the generated.by check, once the language server delivers lint and profile findings
* Updated A body digest inside generated detects real drift, not a rewritten date
* Updated Open Knowledge Format v0.3 specification
* Updated The MCP server is Effect-native and speaks the legacy protocol era
* Updated The validate hook fires PostToolUse, not PreToolUse
* Updated okfit
* Updated A concept outside the repository is a typed failure
* Updated A documentation site at okfit.dev
* Updated A non-empty actors list is an allow-list and okfit never stores emails
* Updated A walk past maxDepth fails typed, never silently truncates
* Updated An @okfit/lsp language server and a VS Code extension over the shared engine
* Updated Bundle, Graph, Derive, and Validate are static facades, not services
* Updated Commits are conventional, DCO signed, never on main
* Updated Concept files are named for their topic; ids stay paths
* Updated Config discovery is assembled through AppConfig.layer, not a hand-rolled resolver chain
* Updated Contributor guide -- making a pull request
* Updated Contributor guides
* Updated Documentation site
* Updated Effect v4 pinned to catalog:effected
* Updated Exactly one Project concept, at the bundle root
* Updated Exit codes are a fixed six-value total order
* Updated Frontmatter splices are a shared engine surface for the CLI's verify and the language server's actions
* Updated Ghost workspace
* Updated Heading anchors match github-slugger, through the kit's slugger
* Updated Human actor ids resolve through a five-step fallback order
* Updated Interactive prompts are gated by audience and terminal, and the audience never refuses a command
* Updated Never flip private in a source package.json
* Updated No process.cwd() or environment reads in profiles
* Updated One engine query layer serves the MCP tools, the CLI and the verify picker
* Updated Plugin
* Updated Publish the VS Code extension
* Updated Relative imports use .js extensions
* Updated Repository README
* Updated Sub-package READMEs
* Updated Tests live in __test__/, never in src/
* Updated The VS Code extension lives at vscode/, not under plugins/ or packages/
* Updated The carrier keeps its front ends' bin names, proven under allowSharedBins
* Updated The language server runs the reference vscode-languageserver library behind an Effect transport seam
* Updated The plugin declares a minimum CLI version and the context envelope reports the CLI's
* Updated The software-project vocabulary grows a fourth time from open migration findings
* Updated The software-project vocabulary grows a second time from the effected and tsdoctor migrations
* Updated The software-project vocabulary grows a third time from the silk action migrations
* Updated The software-project vocabulary grows from what migrations could not express
* Updated Time is an explicit argument, never a Clock service
* Updated Tool packages pin the kit exactly; libraries keep carets and peers
* Updated Two narrow interrupt windows in the LSP session registry are documented, not closed
* Updated Uncommitted provenance is the caller's to interpret
* Updated User docs live under /docs; package hierarchies live at the site root beside their generated API
* Updated Website
* Updated Workspace
* Updated okfit sync is the one command that regenerates every derived-content family
* Updated okfit sync's log mode appends into the newest logged day and dedupes on its own spellings
* Updated process reads confined to the CLI's boundary files
* Updated scratchpad
* Added okfit's own frontmatter keys carry the x-okfit- prefix

## 2026-11-23

* Updated A concept outside the repository is a typed failure
* Updated Core
* Updated Engine
* Updated LSP
* Updated Loading never fails a concept for a bad family
* Added Markdown that is not a concept is skipped, not an error
* Added The declared OKF version gates the v0.2 fallbacks
* Added The root index's metadata is read and kept
* Updated VS Code Extension
* Updated okfit config file schema
* Updated Interactive prompts are gated by audience and terminal, and the audience never refuses a command
* Updated The software-project vocabulary grows from what migrations could not express
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated okfit sync --staged stamps the git index with now, the one place a wall-clock stamp is honest

## 2026-11-21

* Updated Profiles
* Updated CLI
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated okfit sync --staged stamps the git index with now, the one place a wall-clock stamp is honest
* Updated Interactive prompts are gated by audience and terminal, and the audience never refuses a command
* Updated Workspace
* Added A concept outside the repository is a typed failure
* Added A cited file that other checkouts cannot see is a lint, split by whether it is ignored
* Updated Engine
* Updated okfit config file schema
* Added The plugin declares a minimum CLI version and the context envelope reports the CLI's
* Added The software-project vocabulary grows a fourth time from open migration findings
* Updated The software-project vocabulary grows from what migrations could not express

## 2026-11-13

* Updated Plugin
* Updated The carrier keeps its front ends' bin names, proven under allowSharedBins
* Updated Workspace

## 2026-11-12

* Added Tool packages pin the kit exactly; libraries keep carets and peers

## 2026-11-09

* Updated Website

## 2026-11-08

* Updated Contributor guide -- making a pull request
* Updated Ghost workspace
* Updated Never flip private in a source package.json
* Updated Plugin
* Updated Tests live in __test__/, never in src/
* Updated User docs live under /docs; package hierarchies live at the site root beside their generated API
* Updated Website
* Updated Workspace
* Updated scratchpad
* Updated Core

## 2026-11-05

* Updated okfit config file schema
* Updated okfit-mcp — MCP tool and resource contract
* Added Heading anchors match github-slugger, through the kit's slugger

## 2026-11-02

* Updated A shared @okfit/engine package replaces cli-as-copy-contract
* Updated CLI
* Updated Engine
* Updated Interactive prompts are gated by audience and terminal, and the audience never refuses a command
* Updated LSP
* Updated MCP
* Updated The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first
* Updated The engine version, not the producer version, is what a report is compared on
* Updated The language and MCP servers survive a stray crash once serving, and exit on one before
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated okfit's front ends build on @effected/{engine,cli,mcp} rather than hand-rolled equivalents
* Updated okfit-mcp — MCP tool and resource contract
* Updated process reads confined to the CLI's boundary files

## 2026-10-31

* Updated Effect v4 pinned to catalog:effected
* Updated Engine
* Updated LSP
* Updated MCP
* Updated Profiles
* Updated Workspace
* Updated scratchpad
* Updated Every okfit digest lives in one integrity family, outside the spec's families
* Updated The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first

## 2026-10-28

* Updated Engine
* Updated Profiles

## 2026-10-27

* Updated Engine
* Updated Profiles
* Updated The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first
* Updated The engine version, not the producer version, is what a report is compared on
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated okfit-mcp — MCP tool and resource contract

## 2026-10-25

* Updated AI Plugins
* Updated Agent plugin hooks contract
* Updated Engine
* Updated Profiles
* Updated The PostToolUse hook keeps only conformance blocking and the generated.by check, once the language server delivers lint and profile findings
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated okfit sync --staged stamps the git index with now, the one place a wall-clock stamp is honest
* Updated A non-empty actors list is an allow-list and okfit never stores emails
* Updated A verification is bound to the content it covered
* Updated Concept files are named for their topic; ids stay paths
* Updated Every okfit digest lives in one integrity family, outside the spec's families
* Updated Verification drift is a signal to weigh, never a gate
* Updated stale --verify rolls stale_after forward, and plain verify never does

## 2026-10-12

* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale

## 2026-10-11

* Updated A body digest inside generated detects real drift, not a rewritten date
* Added A verification is bound to the content it covered
* Updated AI Plugins
* Updated Agent plugin hooks contract
* Updated CLI
* Updated Core
* Updated Engine
* Added Every okfit digest lives in one integrity family, outside the spec's families
* Updated Frontmatter splices are a shared engine surface for the CLI's verify and the language server's actions
* Updated Human actor ids resolve through a four-step fallback order
* Updated LSP
* Updated MCP
* Updated Profiles
* Added Verification drift is a signal to weigh, never a gate
* Added integrity frontmatter family
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated okfit config file schema
* Updated okfit sync --staged stamps the git index with now, the one place a wall-clock stamp is honest
* Updated okfit verify edits frontmatter by textual splice, never by re-serialisation
* Updated okfit-mcp — MCP tool and resource contract
* Updated stale --verify rolls stale_after forward, and plain verify never does
* Updated VS Code Extension
* Updated An @okfit/lsp language server and a VS Code extension over the shared engine
* Updated Config discovery is assembled through AppConfig.layer, not a hand-rolled resolver chain
* Updated okfit sync's log mode appends into the newest logged day and dedupes on its own spellings
* Added A non-empty actors list is an allow-list and okfit never stores emails
* Updated Human actor ids resolve through a five-step fallback order
* Updated The PostToolUse hook keeps only conformance blocking and the generated.by check, once the language server delivers lint and profile findings
* Updated The validate hook fires PostToolUse, not PreToolUse
* Added Concept files are named for their topic; ids stay paths
* Updated A documentation site at okfit.dev
* Updated Interactive prompts are gated by audience and terminal, and the audience never refuses a command
* Updated Plugin
* Updated The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first
* Updated The software-project vocabulary grows a second time from the effected and tsdoctor migrations
* Updated Website
* Updated Workspace
* Updated process reads confined to the CLI's boundary files
* Updated A shared @okfit/engine package replaces cli-as-copy-contract
* Updated A walk past maxDepth fails typed, never silently truncates
* Updated Tests live in __test__/, never in src/
* Updated The engine version, not the producer version, is what a report is compared on
* Updated okfit's front ends build on @effected/{engine,cli,mcp} rather than hand-rolled equivalents

## 2026-10-09

* Updated CLI
* Updated Engine
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Added stale --verify rolls stale_after forward, and plain verify never does

## 2026-10-06

* Added AI Plugins
* Updated Agent plugin hooks contract
* Updated An @okfit/lsp language server and a VS Code extension over the shared engine
* Updated LSP
* Updated Never flip private in a source package.json
* Updated Plugin
* Updated Repository README
* Updated Tests live in __test__/, never in src/
* Updated The PostToolUse hook keeps only conformance blocking and the generated.by check, once the language server delivers lint and profile findings
* Updated The VS Code extension lives at vscode/, not under plugins/ or packages/
* Updated VS Code Extension
* Updated Website
* Updated Workspace
* Updated okfit
* Updated scratchpad

## 2026-10-05

* Updated CLI
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated MCP
* Updated The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first
* Updated okfit-mcp — MCP tool and resource contract
* Updated Plugin
* Added The carrier keeps its front ends' bin names, proven under allowSharedBins
* Updated Workspace
* Updated LSP
* Added The language and MCP servers survive a stray crash once serving, and exit on one before
* Updated An @okfit/lsp language server and a VS Code extension over the shared engine
* Updated Engine
* Updated VS Code Extension
* Updated Frontmatter splices are a shared engine surface for the CLI's verify and the language server's actions

## 2026-10-03

* Updated MCP
* Updated Profiles
* Updated okfit-mcp — MCP tool and resource contract
* Updated Claude Code Plugin
* Added Contributor guide -- making a pull request
* Added Contributor guides
* Added Documentation site
* Added Repository README
* Added Sub-package READMEs
* Updated okfit config file schema
* Updated LSP
* Updated VS Code Extension
* Updated Engine

## 2026-10-02

* Updated okfit config file schema
* Updated Core
* Updated Engine
* Updated Profiles
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale

## 2026-10-01

* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale
* Updated CLI
* Updated Engine
* Added Interactive prompts are gated by audience and terminal, and the audience never refuses a command
* Updated process reads confined to the CLI's boundary files

## 2026-09-30

* Updated CLI
* Updated Engine
* Updated MCP
* Added One engine query layer serves the MCP tools, the CLI and the verify picker
* Updated okfit CLI — validate, init, context, verify, query, sync, lint, graph, stale

## 2026-09-29

* Added A documentation site at okfit.dev
* Added User docs live under /docs; package hierarchies live at the site root beside their generated API
* Added Website
* Updated Workspace

## 2026-09-28

* Updated CLI
* Updated Effect v4 pinned to catalog:effect
* Updated MCP
* Updated The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first
* Updated The language server runs the reference vscode-languageserver library behind an Effect transport seam
* Updated Workspace
* Updated okfit's front ends build on @effected/{engine,cli,mcp} rather than hand-rolled equivalents

## 2026-09-24

* Updated CLI
* Updated Engine
* Updated LSP
* Updated MCP
* Updated The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first
* Updated Workspace
* Added okfit's front ends build on @effected/{engine,cli,mcp} rather than hand-rolled equivalents
* Updated okfit-mcp — MCP tool and resource contract
* Updated process reads confined to the CLI's boundary files
* Updated A shared @okfit/engine package replaces cli-as-copy-contract
* Updated Core
* Updated Plugin
* Updated The engine version, not the producer version, is what a report is compared on
* Updated okfit CLI — validate, init, context, verify, sync, lint, graph, stale
* Updated okfit config file schema

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
* Added Frontmatter splices are a shared engine surface for the CLI's verify and the language server's actions

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
