---
"@okfit/profiles": minor
---

## Features

Adds software-project vocabulary round four. A `Flow` type (directory `flows/`, optional path fields `entry`, `crosses` and `resource`) holds a runtime sequence across several modules. A `Fixture` type (directory `fixtures/`, `resource` required, optional `runbooks`) holds a stand-in for an external thing and takes the default 90-day staleness window. A `config` tag covers a project's own user-facing configuration, and `compat` now also covers portability across agent hosts, runtimes, and operating systems.
