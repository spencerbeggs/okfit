---
"@okfit/cli": minor
---

## Breaking Changes

### The project root is a flag

* Every command takes the project root as `--root <dir>` instead of a trailing `[path]` positional, so positionals name concept targets everywhere. Replace `okfit validate ./project` with `okfit validate --root ./project`.
* Update the okfit agent plugin (`@okfit/ai-plugins`) together with the CLI: a plugin from before this release passes the project root as a positional, which this CLI now reads as a concept target and refuses.

### An unknown concept is a usage error

* An unknown concept id is now a usage error (exit 64) on `okfit verify`, listing every bad target with a suggestion, instead of exit 3.
* An unknown concept on `okfit query get` is exit 64, not 3.

## Features

### Several concepts at once

* `okfit verify` and `okfit verify --revoke` take any number of concept targets, mixing ids and paths. Nothing is written unless every target resolves.
* `okfit query get` takes several targets and returns a JSON array for more than one; `okfit validate` and `okfit lint` take optional targets that scope the reported diagnostics.

### okfit mv

* `okfit mv <from> <to>` moves a concept and rewrites every reference to it across the bundle. `--dry-run` prints the plan, including every file that will need re-verifying.
