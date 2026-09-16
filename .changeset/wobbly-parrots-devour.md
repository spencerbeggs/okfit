---
"@okfit/core": minor
---

## Features

### New lint rule: `generated-missing`

A concept with no `generated:` block is now flagged at validate time when `actors.agent` is configured, instead of surfacing only as a skip in `okfit sync`'s post-commit output. Configure its severity under the `[lint]` table's new `generated_missing` key (default `"warn"`); the rule is silent when `actors.agent` is unset.

```toml
[lint]
generated_missing = "warn" # or "error" / "off"
```

The config JSON Schema is regenerated to include the new key.
