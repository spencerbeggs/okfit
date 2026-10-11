---
"@okfit/cli": minor
---

## Breaking Changes

### The project root is a flag

* Every command takes the project root as `--root <dir>` instead of a trailing `[path]` positional, so positionals name concept targets everywhere. Replace `okfit validate ./project` with `okfit validate --root ./project`.

### An unknown concept is a usage error

* An unknown concept id is now a usage error (exit 64) on `okfit verify`, listing every bad target with a suggestion, instead of exit 3.

## Features

### Several concepts at once

* `okfit verify` and `okfit verify --revoke` take any number of concept targets, mixing ids and paths. Nothing is written unless every target resolves.
