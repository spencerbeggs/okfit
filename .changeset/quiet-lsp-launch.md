---
"@okfit/lsp": patch
---

## Bug Fixes

- Report a launch failure on stderr. Launched without `HOME`, `okfit-lsp` wrote its `XdgEnvError` report to stdout, the JSON-RPC wire, where a client read it as a corrupt frame; it now exits `1` with the report on stderr and stdout empty, through `LspStdio.launch`.
- Install the crash guards through `ProcessGuard.run` from `@effected/engine/guard` with an `exitBeforeConnect` policy, as `okfit-mcp` does: a stray exception before the server is serving exits `1`, and one after it is logged to stderr while the server keeps answering. Reports now read `okfit-lsp: uncaughtException (<origin>): ...` and `okfit-lsp: unhandledRejection: ...`.
- Launch through `LspStdio.launch` and `LspStdio.teardown` from `@effected/lsp` (new runtime dependency) instead of hand-written `runMain` options: the exit code mapping and the explicit exit on `exit` are the kit's, and behaviour is unchanged.

## Tests

- The suite pins both halves of the crash policy and the stderr-only launch failure against the built bin, driven through `LspProcess` from `@effected/lsp/testing`.
