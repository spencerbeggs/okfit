---
"@okfit/claude-code-plugin": minor
---

## Breaking Changes

### The PostToolUse validate hook no longer surfaces lint or profile findings

The hook that runs after every Write or Edit under a bundle now only checks two things: it blocks on a `core.conformance` hit on the file just written or edited, and it blocks (on `Write`) or warns (on `Edit`) when a concept is missing its `generated.by` stamp. It no longer reports `core.lint` or profile diagnostics through `additionalContext` — those are now delivered directly in the editor, with a precise range, by the `@okfit/lsp` language server registered alongside this plugin. If you were relying on the hook's chat output to see lint or profile warnings, register the language server (or run `okfit validate`) to keep seeing them.
