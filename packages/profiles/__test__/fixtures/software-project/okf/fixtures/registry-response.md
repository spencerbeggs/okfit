---
type: Fixture
status: stable
title: Recorded registry response
description: A saved npm registry response the resolver tests replay.
resource: ../../vitest.config.ts
runbooks: [../runbooks/release.md]
stale_after: 2027-03-01T00:00:00Z
---

# Recorded registry response

Stands in for the live registry. Captured once from the public registry; if the real response shape changes, replays keep passing while production breaks.
