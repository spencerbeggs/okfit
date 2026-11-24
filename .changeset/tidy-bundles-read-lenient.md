---
"@okfit/core": minor
---

## Breaking Changes

### Markdown without frontmatter or `type` is skipped, not an error

Per OKF v0.3 §3.2, a `.md` file with no frontmatter or no `type` is no longer a conformance error. It is skipped with a warning: `frontmatter-missing` or `type-missing` (default `warn`; configure with the `frontmatter_missing` and `type_missing` keys). A bundle that holds a README no longer exits 2. A frontmatter block that is a YAML list or scalar is still a conformance error, now reported as `frontmatter-unparseable`.

### Tolerant reading of values (OKF v0.3 §11.2)

- `null`, an empty string and an empty list read as absent.
- A single item reads as a list of one for `tags`, `sources`, `verified` and `parameters`.
- An entry is ignored only when it lacks a required key (`entry-ignored`); a malformed optional key is dropped alone (`value-malformed`); a value outside its vocabulary is kept (`value-unknown`, today `status`).
- These are warnings, so a bundle whose only errors were `family-invalid` on spec-defined values now exits 0. `family-invalid` remains an error only for okfit's own `x-okfit-integrity` family.

### Type-level breaks

- `ConformanceCode` loses `frontmatter-missing` and `type-missing`; both are now `LintCode` members.
- `Derive.status` returns `DerivedStatus`, which adds `unknown`. `Staleness` gains `malformed`. `PathField` gains `superseded_by`.
- `Timestamp` accepts a date-only value (`YYYY-MM-DD`, read as midnight UTC) everywhere it is used.
- `superseded_by` moves out of `Concept.extensions` into a typed field. A bundle that already used it as an extension key now gets a graph edge, and a `broken-links` warning when its target is missing.

### Tolerant reading can raise a trust tier

A `verified` list with one good and one bad entry used to be dropped whole, so the concept read as unverified. It now keeps the good entry and warns about the bad one, so the concept can reach a higher trust tier than before.

### Other behavior changes

- A symbolic link that resolves outside the bundle root is not listed or read (`symlink-escape`, warn).
- `UsageWindow.from` and `to`, `ComputationExecutor.resource` and `receipt`, and `ComputationAttester.resource` are now optional.
- `LoadedConcept.computationBody` is, for a bundle that declares OKF 0.3 or later, the code of the first fenced block in the `Computation` section at any heading level. For 0.2 or undeclared bundles it is unchanged.
- A bare link or path-field value falls back to the bundle root only for a bundle that declares 0.2 or earlier, or nothing.

## Features

- New `OkfVersion` module: parse, compare, read a bundle's declared version, and the legacy gate.
- The root `index.md` may carry `title`, `description`, `license` and extension keys. `IndexDocument` exposes them and the raw frontmatter; the `index-metadata-invalid` lint checks them.
- `Derive.renderIndex` keeps existing root frontmatter (`RenderIndexOptions.frontmatter`).
- Date-only timestamps read as the start of that day in UTC.
- `superseded_by` is a typed field, a path field and a graph edge.
- `DerivedStatus` adds `unknown`, and `Derive.rawStatus` returns the raw value. `Staleness` adds `malformed`.
- `team:` is a known actor scheme, and `actor-prefix-unknown` also checks `sources[].author`.
- `EntryPaths` and `Concept.entryPath` give the YAML position of each kept list entry.
- `computation-runtime-missing` also fires when `runtime` is present but unreadable.
