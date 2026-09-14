---
type: Gotcha
title: A missing dist link mid-test is not breakage
description: The test global setup rebuilds dist, so a missing link during a run is transient.
resource: ../../vitest.config.ts
stale_after: 2027-03-01T00:00:00Z
---

# A missing dist link mid-test is not breakage

You see a dangling `dist/dev` symlink and conclude the build broke; the global setup is rebuilding it and the link returns before the first test runs.
