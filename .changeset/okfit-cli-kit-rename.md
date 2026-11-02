---
"@okfit/cli": patch
---

## Refactoring

Imports the kit's front-end libraries under their new names, `@effected/cli-kit` (was `@effected/cli`) and `@effected/kit` (was `@effected/engine`). The CLI's behaviour and exports are unchanged; types the declarations re-export, such as `CliTheme` and `FailureDetails`, now resolve from `@effected/cli-kit`.
