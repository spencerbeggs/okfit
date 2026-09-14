---
"@okfit/profiles": minor
---

## Features

### Two new types

* `Invariant` (`invariants/`) — a property the code holds by construction, enforced by the type system or pinned by a test, not followed by people; optional path-kind `resource` naming the type, function, or test that enforces it
* `Incident` (`incidents/`) — a dated production failure kept as one narrative: what shipped broken, how it looked, the root cause, and the guard; requires `occurred` (free text, an ISO 8601 date) and takes an optional path-kind `guard`

### A new Module kind

* `worker` — a detached sidecar or worker bundle another module spawns, with its own lifecycle, that is not itself a package or action

### Two new tags

* `github` — the GitHub platform surface: the APIs, Apps and tokens, Actions, Packages, check runs, pull request conventions
* `docs` — the documentation itself: provenance, rot, re-derivation, and what a claim would take to falsify

### Guidance

* `Gotcha` says to omit `resource` and name the outside system when nothing in this repository produces the misleading signal, and that a known bug nobody is scheduled to fix is a Gotcha until the fix is planned
* `Roadmap` says the converse: a known bug with nobody queued to fix it is a Gotcha, not a Roadmap

`okfit init` scaffolds the two new directories. Existing bundles are unaffected: the types, kind, and tags are available, not required.
