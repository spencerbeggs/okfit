---
"@okfit/cli": patch
---

## Features

* `okfit sync` prints one warning on stderr when a `generated.at`, or a changed concept's commit date, is more than the tolerance ahead of the clock. Sync keeps acting and the exit code is unchanged; under `--format json` the envelope's `clock_behind` key carries it and stderr stays empty (#509)
* The interactive confirm screen of `okfit sync` shows that warning below the plan, so a cancel still shows it and it is not printed again after the writes (#509)

## Tests

* The migration summary's fallback, which counts no refusals when its plan fails, is now covered (#506)
