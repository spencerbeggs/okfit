---
"@okfit/engine": minor
---

## Features

The engine now re-exports the `AppDirs`, `Xdg` and `XdgEnvError` types from `@effected/xdg`. These are the services and the failure `OkfitPlatform` brings in. A front end whose commands require them can now name them through `@okfit/engine`. Before, TypeScript 7.1 rejected the inferred types of those commands with TS2883 ("cannot be named without a reference to ..."). Nothing changes at runtime.
