---
"@okfit/mcp": patch
---

## Refactoring

* `list_concepts`, `get_concept` and `concept_neighbors` now delegate to `@okfit/engine`'s `ConceptQuery`; the tool contracts are unchanged
