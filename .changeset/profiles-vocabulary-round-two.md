---
"@okfit/profiles": minor
---

## Features

### Three new types

* `Consumer` (`consumers/`) — an external application that consumes this repository and thereby scopes it; requires `repository`
* `Roadmap` (`roadmaps/`) — a gate and the forward-looking work behind it, held as intent rather than as a Decision; optional free-text `gate`
* `Measurement` (`measurements/`) — a dated empirical result; optional path-kind `justifies` naming the Decisions it supports

### Three new tags

* `bundle` — install weight and reachability, distinct from runtime `performance`
* `observability` — how the system reports on itself
* `deps` — how third-party dependencies are declared, pinned, and distributed

`okfit init` scaffolds the three new directories. Existing bundles are unaffected: the types are available, not required.
