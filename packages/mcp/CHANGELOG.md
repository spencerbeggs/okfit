# @okfit/mcp

## 0.6.0

### Breaking Changes

- Every served tool's `inputSchema` is now closed (`additionalProperties: false`
  at every object node), and a `tools/call` whose arguments include a key the
  schema does not declare now fails, naming every unknown key at every depth
  plus the accepted params at that level, instead of the argument being
  silently dropped. The failure shape depends on the negotiated protocol
  revision: on `2025-11-25` and `2026-07-28` (Claude Code's default path) the
  client gets a normal `tools/call` result with `isError: true` and the text
  `Unrecognized parameter(s): …`; only `2025-06-18` returns a JSON-RPC
  `InvalidParams` (`-32602`).

- **Upgrade action:** send only a tool's declared arguments. A client that
  previously sent extra or speculative keys alongside a valid call will now get
  a hard failure instead of having those keys ignored.

```jsonc
// Before: `extra` was silently dropped, the call succeeded
{ "name": "get_concept", "arguments": { "id": "decisions/cli-exit-codes", "extra": 1 } }

// Now (2025-11-25 / 2026-07-28): isError: true, "Unrecognized parameter(s): extra..."
// Now (2025-06-18): JSON-RPC error -32602 (InvalidParams)
```

- `@okfit/mcp`'s barrel (`src/index.ts`) drops two `@public` functions and
  widens a `@public` schema:

- `composeRemediatedMessage` and `truncateEchoed` are no longer exported.
  **Upgrade action:** use `@effected/mcp`'s `ToolFailure.message(raw,
  remediation)` and `ToolFailure.truncate(value, limit?)` in their place.

- `Remediation` (`{ hint, suggestedTool? }`) is replaced by
  `@effected/engine`'s `Remediation`, which additionally accepts an optional
  `suggestedArgs?: Record<string, unknown>`. Every `McpToolError` member's
  schema now accepts that key. `Remediation` is now re-exported from
  `@effected/engine`, not declared by this package.

### Bug Fixes

- A stdin line that is not valid JSON now gets a JSON-RPC `-32700` reply and the server keeps serving, instead of wedging permanently on the first bad line.
- Valid JSON that is not a JSON-RPC request or notification (for example a bare `null`) now gets a JSON-RPC `-32600` reply and the server keeps serving.
- An unexpanded literal `${CLAUDE_PROJECT_DIR}` placeholder in the environment is now ignored rather than used as the project root, so a host that leaves the variable unexpanded on some launch paths falls through to the next candidate. Likewise, an empty or whitespace-only `OKFIT_PROJECT_DIR` or `CLAUDE_PROJECT_DIR` is now skipped instead of used as-is -- previously `OKFIT_PROJECT_DIR=""` was returned verbatim, since `??` does not skip an empty string. `OKFIT_PROJECT_DIR` still takes precedence over `CLAUDE_PROJECT_DIR`, and the working directory is used only when both keys are unset, empty/whitespace-only, or an unexpanded placeholder. [#186][#186]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/engine | dependency | updated | 0.8.0 | 0.9.0 |
| @effected/engine | dependency | added | — | ^0.1.0 |
| @effected/mcp | dependency | added | — | ^0.1.0 |

[#187][#187]

[#186][#186]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#186]: https://github.com/spencerbeggs/okfit/pull/186

[#187]: https://github.com/spencerbeggs/okfit/pull/187

## 0.5.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.7.4 | 0.8.0 |
| @okfit/engine | dependency | updated | 0.7.5 | 0.8.0 |
| @okfit/profiles | dependency | updated | 0.7.5 | 0.8.0 |

## 0.5.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |
| @effected/git | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/xdg | dependency | updated | ^0.6.1 | ^0.7.0 |
| @okfit/core | dependency | updated | 0.7.3 | 0.7.4 |
| @okfit/engine | dependency | updated | 0.7.4 | 0.7.5 |
| @okfit/profiles | dependency | updated | 0.7.4 | 0.7.5 |
| effect | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |

[#173][#173]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#173]: https://github.com/spencerbeggs/okfit/pull/173

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/xdg | dependency | updated | ^0.6.0 | ^0.6.1 |
| @okfit/core | dependency | updated | 0.7.2 | 0.7.3 |
| @okfit/engine | dependency | updated | 0.7.3 | 0.7.4 |
| @okfit/profiles | dependency | updated | 0.7.4 | 0.7.4 |

[#169][#169]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#169]: https://github.com/spencerbeggs/okfit/pull/169

## 0.5.0

### Features

#### MCP protocol 2026-07-28 and server instructions

- `okfit-mcp` now offers three protocol adapters, newest first: `2026-07-28`, `2025-11-25` and `2025-06-18`. `2026-07-28` is the stateless revision (MCP SEP-2575): a client opens with `server/discover` instead of `initialize`, every request self-identifies through `params._meta`, and every result is wrapped in the stateless frame (`resultType`, `_meta["io.modelcontextprotocol/serverInfo"]`, `ttlMs`, `cacheScope`). The two stateful adapters stay, so a client that opens with `initialize` is served exactly as before.

- Measured against Claude Code 2.1.278: by default (or with `MCP_PROTOCOL_NEGOTIATION=legacy`) it opens with `initialize` and negotiates `2025-11-25`; with `MCP_PROTOCOL_NEGOTIATION=auto` it opens with `server/discover` and runs on `2026-07-28`. Both paths call tools successfully.

- The server now also registers `instructions`, an agent-facing orientation (which tool to call first, the id format, the success and failure envelopes), surfaced in both the `initialize` and the `server/discover` results. It is exported as `SERVER_INSTRUCTIONS`.

- Invalid tool parameters remain a JSON-RPC `-32602` error on `2025-06-18` and an `isError: true` result on `2025-11-25` and `2026-07-28`; this is the per-revision behaviour of the runtime, not a change in this release.

- Under effect `4.0.0-rc.116` a declared tool failure (`isError: true`, message in `content[0].text`) is no longer accompanied by a log line on stderr; only an internal failure is logged. [#162][#162]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effected/git | dependency | updated | ^0.15.2 | ^0.16.0 |
| @effected/xdg | dependency | updated | ^0.5.3 | ^0.6.0 |
| @okfit/core | dependency | updated | 0.7.1 | 0.7.2 |
| @okfit/engine | dependency | updated | 0.7.2 | 0.7.3 |
| @okfit/profiles | dependency | updated | 0.7.3 | 0.7.4 |
| effect | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

[#162][#162]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#162]: https://github.com/spencerbeggs/okfit/pull/162

## 0.4.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/git | dependency | updated | ^0.15.1 | ^0.15.2 |
| @effected/xdg | dependency | updated | ^0.5.2 | ^0.5.3 |
| @okfit/engine | dependency | updated | 0.7.1 | 0.7.2 |

[#156][#156]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#156]: https://github.com/spencerbeggs/okfit/pull/156

## 0.4.1

### Bug Fixes

- fixes pnpm v12 clsure issues

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.7.0 | 0.7.1 |
| @okfit/engine | dependency | updated | 0.7.0 | 0.7.1 |
| @okfit/profiles | dependency | updated | 0.7.2 | 0.7.3 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.4.0

### Features

#### Distribution-aware server and `main()`

- `ServerLayer` accepts a new optional second argument of the new exported `ServerOptions` type, and `main()` accepts the new exported `MainOptions` type — both carry an optional `distribution: { name, version }` threaded into `validate_bundle`'s rendered envelope:

```ts
import { ServerLayer } from "@okfit/mcp";

ServerLayer(projectRoot, { distribution: { name: "@okfit/plugin", version: "0.3.7" } });
```

- Both options are optional and default to no distribution, so existing callers are unaffected. [#139][#139]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.6.0 | 0.7.0 |
| @okfit/engine | dependency | updated | 0.6.0 | 0.7.0 |
| @okfit/profiles | dependency | updated | 0.7.1 | 0.7.2 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#139]: https://github.com/spencerbeggs/okfit/pull/139

## 0.3.7

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.5.0 | 0.6.0 |
| @okfit/engine | dependency | updated | 0.5.0 | 0.6.0 |
| @okfit/profiles | dependency | updated | 0.7.0 | 0.7.1 |

## 0.3.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/xdg | dependency | updated | ^0.5.1 | ^0.5.2 |
| @okfit/core | dependency | updated | 0.4.1 | 0.5.0 |
| @okfit/engine | dependency | updated | 0.4.1 | 0.5.0 |
| @okfit/profiles | dependency | updated | 0.6.0 | 0.7.0 |

[#121][#121]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#121]: https://github.com/spencerbeggs/okfit/pull/121

## 0.3.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/engine | dependency | updated | 0.4.0 | 0.4.1 |
| @okfit/profiles | dependency | updated | 0.5.0 | 0.6.0 |

## 0.3.4

### Features

- The `okfit validate --format json` envelope (and the MCP `validate_bundle` report, which reuses it) gains a `producer` field naming the package that produced the report: `okfit` from the CLI, `@okfit/mcp` from the MCP server. `okfit_version` was already that package's own version, so the two reports over one bundle legitimately differ there; `producer` labels why. [#91][#91]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.4.0 | 0.4.1 |
| @okfit/engine | dependency | updated | 0.3.0 | 0.4.0 |
| @okfit/profiles | dependency | updated | 0.4.0 | 0.5.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/okfit/pull/91

## 0.3.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/git | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/xdg | dependency | updated | ^0.5.0 | ^0.5.1 |
| @okfit/core | dependency | updated | 0.3.1 | 0.4.0 |
| @okfit/engine | dependency | updated | 0.2.1 | 0.3.0 |
| @okfit/profiles | dependency | updated | 0.3.1 | 0.4.0 |

[#64][#64]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#64]: https://github.com/spencerbeggs/okfit/pull/64

## 0.3.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effected/git | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/xdg | dependency | updated | ^0.4.1 | ^0.5.0 |
| @okfit/core | dependency | updated | 0.3.0 | 0.3.1 |
| @okfit/engine | dependency | updated | 0.2.0 | 0.2.1 |
| @okfit/profiles | dependency | updated | 0.3.0 | 0.3.1 |
| effect | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

[#55][#55]

### Other

- Served tool input schemas now declare `additionalProperties: true` on every object with declared properties instead of `false`. Effect's JSON Schema generator leaves unmodeled properties open by default since rc.113, matching the decoder, and `Tool` compiles input schemas without options; unknown keys in a tool call were already ignored at runtime, so only the advertised schema changes. [#55][#55]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#55]: https://github.com/spencerbeggs/okfit/pull/55

## 0.3.1

### Bug Fixes

- `validate_bundle` now declares `Crypto.Crypto` among its dependencies,
  matching the `Crypto.Crypto` requirement `@okfit/profiles`' two-tier
  `generated-at-drift` lint (issue #19) now carries. The tool's parameters
  and output shape are unchanged; this only wires the dependency the
  underlying lint already needed to run correctly. [#49][#49]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.2.0 | 0.3.0 |
| @okfit/engine | dependency | updated | 0.1.0 | 0.2.0 |
| @okfit/profiles | dependency | updated | 0.2.0 | 0.3.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#49]: https://github.com/spencerbeggs/okfit/pull/49

## 0.3.0

### Features

- `@okfit/mcp` no longer depends on `@okfit/cli`. It now depends on `@okfit/engine` directly for the platform layer, config discovery, and the validate/verify/sync/init/context programs it needs.

- `pnpm add -D @okfit/mcp` no longer resolves `@effected/cli` or the CLI's command tree

- `@okfit/mcp` continues to resolve the same user-level config directory as `@okfit/cli`, since both now provide the same `@okfit/engine` `OkfitPlatform` layer

- `@okfit/mcp`'s `./main` export condition (`src/main.ts`, the assembled program) is now supported public surface — it is what `@okfit/plugin`'s bin shims import [#28][#28]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/engine | dependency | updated | 0.0.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#28]: https://github.com/spencerbeggs/okfit/pull/28

## 0.2.0

### Features

- First usable release of `@okfit/mcp`: a Model Context Protocol server, `okfit-mcp`, exposing an OKF bundle to agents over stdio. The server is read-only — no tool or resource ever writes to the bundle, the config, or anywhere else.

- The server resolves its project root as `OKFIT_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → the process's current working directory, with no command-line flags.

#### Six tools

| Tool | Returns |
| --- | --- |
| `describe_vocabulary` | Resolved project/bundle roots, active profile, agent actor, and the config's declared type and tag vocabulary. |
| `list_concepts` | Concept summaries, filterable by type, tags, and status; paginated with `limit`/`offset`. |
| `get_concept` | One concept's full decoded frontmatter, raw markdown text, bundle-relative path, and outgoing links. |
| `concept_neighbors` | A concept's graph neighbours — everything it links to and everything that links to it. |
| `stale_report` | Every concept past its `stale_after` instant, as of now or an explicit instant. |
| `validate_bundle` | The same conformance and lint report `okfit validate --format json` produces. |

#### Two resources

- `okf://index` re-reads the bundle's root `index.md` from disk on every call. `okf://concept/<id>` registers one static resource per concept, loaded when the server starts; edits to an already-listed concept are picked up live, but a concept added or removed after boot needs a server restart to appear.

- A failing tool call reaches the client as `isError: true`, with the remediation hint folded into the message text, across five typed error cases: `ConfigError`, `BundleNotFound`, `ConceptNotFound`, `UnknownVocabulary`, and `InvalidArgument`. [#16][#16]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/cli | dependency | updated | 0.1.0 | 0.2.0 |
| @okfit/core | dependency | updated | 0.1.0 | 0.2.0 |
| @okfit/profiles | dependency | updated | 0.1.0 | 0.2.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#16]: https://github.com/spencerbeggs/okfit/pull/16

## 0.1.0

### Features

- Bootstrap the okfit monorepo with package skeletons for core, profiles, cli, mcp, plugin, and the Claude Code plugin.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.0.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!
