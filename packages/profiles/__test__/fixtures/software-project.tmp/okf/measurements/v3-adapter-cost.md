---
type: Measurement
title: Cost of an Effect v3 adapter layer
description: A v3 compatibility adapter doubled the test matrix and added no consumer, measured before the v4-only decision.
justifies: ../decisions/effect-v4.md
stale_after: 2027-03-01T00:00:00Z
tags: [testing]
---

# Cost of an Effect v3 adapter layer

Method: ran the suite with and without the adapter on 2026-09-01. Inputs: 148 tests. Result: 296 tests, 2.1x wall time, zero consumers requesting v3. Ruled out: keeping the adapter.
