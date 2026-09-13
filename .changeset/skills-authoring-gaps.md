---
"@okfit/claude-code-plugin": patch
---

## Documentation

* `okf-config` lists the new `Consumer`, `Roadmap`, and `Measurement` types and the `bundle`, `observability`, and `deps` tags, with guidance on choosing between near neighbours
* `okf-config` no longer recommends a one-line nested `okf/.markdownlint-cli2.jsonc`: a nested `config` replaces the root's wholesale, re-enabling every rule the root disabled
* `okf-authoring` rule 6 states that a footnote label must equal its `sources[].id` verbatim; rule 17 covers descriptions with embedded double quotes
