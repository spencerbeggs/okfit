---
"@okfit/mcp": minor
---

## Breaking Changes

`get_concept` and `concept_neighbors` no longer answer an id that names no concept with an `isError: true` result. It is an expected outcome, so it now comes back on the success channel (`isError` unset) as `@effected/mcp`'s `ToolOutcome` envelope:

```json
{ "ok": false, "error": { "_tag": "QueryConceptNotFoundError", "id": "metrics/nope", "reason": "not-a-concept", "message": "no concept \"metrics/nope\" in this bundle", "remediation": { "hint": "Call list_concepts to see the ids this bundle contains.", "suggestedTool": "list_concepts" } } }
```

`reason` is `empty-id` or `not-a-concept`. A found result now carries `ok: true` beside its existing fields, so a client discriminates on `ok`. Every other failure (config, an unreadable bundle, an invalid argument) is still `isError: true` with the remediation in the message text.

## Features

- Exports `ConceptNotFound`, `GetConceptFound` and `ConceptNeighborsFound`; `GetConceptSuccess` and `ConceptNeighborsSuccess` are now the envelope unions, served with the failure member under `$defs/ConceptNotFound`.
- The server instructions describe the not-found envelope.
