---
"@okfit/lsp": minor
---

## Features

- When a concept has an unknown status or is not current, the server returns the verify code action as disabled, with the reason. This applies only to a client that advertises `disabledSupport`; other clients still get no action.
- New export `CodeActionOptions`, an optional argument of `registerCodeActions`.
