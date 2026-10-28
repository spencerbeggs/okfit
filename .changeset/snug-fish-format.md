---
"@okfit/cli": patch
---

## Maintenance

* The `--format` flag is declared with `CliFormat.flag` on every command. Accepted values and the JSON output bytes are unchanged; help and usage-error text now lists the choices as `json, human` (`graph`: `json, mermaid, dot`).
