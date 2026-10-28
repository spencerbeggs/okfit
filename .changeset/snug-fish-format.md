---
"@okfit/cli": patch
---

## Maintenance

* The `--format` flag is declared with `CliFormat.flag` on every command, and JSON prints through `CliFormat.printJson`. Accepted values and defaults are unchanged, and the JSON is the same single line; under GitHub Actions a `##[` inside it is written as a JSON escape, which parses to the same value. Help and usage-error text now list the choices as `json, human` (`graph`: `json, mermaid, dot`).
