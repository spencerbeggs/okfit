---
"@okfit/mcp": patch
---

## Other

* Served tool input schemas now declare `additionalProperties: true` on every object with declared properties instead of `false`. Effect's JSON Schema generator leaves unmodeled properties open by default since rc.113, matching the decoder, and `Tool` compiles input schemas without options; unknown keys in a tool call were already ignored at runtime, so only the advertised schema changes.
