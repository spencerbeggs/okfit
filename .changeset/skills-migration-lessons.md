---
"@okfit/claude-code-plugin": patch
---

## Documentation

* `okf-config` lists the new `Invariant` and `Incident` types, the `worker` Module kind, and the `github` and `docs` tags, with near-neighbour guidance for Invariant vs Convention, Incident vs Gotcha plus Decision, and a known bug between Gotcha and Roadmap; a new paragraph says framework tags such as `effect` stay repo-local and how to declare one
* `okf-authoring` rule 6 now says a footnote needs both the inline `[^id]` and the `[^id]:` definition line, and that an orphan definition is what markdownlint MD053 rejects; rule 18 covers the markdownlint autofix traps (code-span paths in footnote definitions, never starting a line with `#N`, hard tabs in lifted fences, linting scoped to your own files); rule 19 says a "was X, now Y" historical delta survives only inside the Decision it justifies
* `okf-context` names the eight real `okfit` subcommands and the MCP tools as the only things a CLAUDE.md router may cite for browsing the bundle — there is no `okfit list` or `okfit show`
