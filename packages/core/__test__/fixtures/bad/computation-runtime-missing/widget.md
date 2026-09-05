---
type: Attested Computation
title: Widget count
parameters:
  - { name: year, type: integer, required: true }
executor:
  resource: run.md
  receipt: [job_id]
---

# Computation

    SELECT COUNT(*) FROM widgets WHERE year = @year
