---
"@okfit/lsp": minor
---

## Breaking Changes

* `registerCodeActions`, `registerCommands` and `verifiedTextEdits` now require `Crypto.Crypto` in their context, to compute the content digest a verification binds. Provide a crypto layer (for example `NodeServices.layer` from `@effect/platform-node`) where these are run.
* `EditTarget` gains a required `binding` field: the recorded `integrity.verified` `{ by, content }`, or `undefined` when the concept carries none. Code building an `EditTarget` by hand must supply it.

## Features

* The verify code action and commands write the `integrity.verified` binding beside the new `verified` entry, and offer a verify action again when a concept's binding has drifted
