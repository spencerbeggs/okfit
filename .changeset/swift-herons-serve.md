---
"@okfit/lsp": minor
---

## Features

### Document links, definition, references, hover and workspace symbols

The language server now answers five more LSP requests over a workspace folder's last-loaded bundle:

- `textDocument/documentLink`, `textDocument/definition` and `textDocument/references` — navigate between a concept's body links and frontmatter path fields and the concepts they point at.
- `textDocument/hover` — a link or frontmatter path field under the cursor renders its target concept's title, type, status, trust tier and staleness; a `type:` value renders that type's description and guidance; a top-level frontmatter key renders its field description, all sourced from the bundle's config vocabulary.
- `workspace/symbol` — a case-insensitive substring match over every live session's concepts by id and title (an empty query matches everything), capped at 200 results.

### Config changes reload a folder instead of requiring a restart

Editing a workspace folder's config file now reloads that folder's session in place — rebuilding it, retrying a config that previously failed to load, and clearing whatever was published for the old session before the new one starts publishing. Previously a config change needed a server restart to take effect.

### Diagnostics are cleared when a session is dropped

Closing a workspace folder, or otherwise dropping its session, now clears any diagnostics the server had published for it, instead of leaving stale diagnostics behind in the editor.

### Debounce now has a maximum wait

The revalidate debounce that coalesces bursts of edits behind a fixed delay now also has a `maxWait` ceiling: a steady stream of edits that never lets the debounce quiet down still triggers a revalidate once `maxWait` has elapsed since the burst started, instead of being deferred indefinitely.
