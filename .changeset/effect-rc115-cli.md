---
"@okfit/cli": patch
---

## Refactoring

* Ports every command to the rc.113 PascalCase CLI constructors (`Flag.String`, `Flag.Boolean`, `Flag.File`, `Flag.Literals`, `Argument.Path`, and friends); parsing, help output and exit codes are unchanged.
