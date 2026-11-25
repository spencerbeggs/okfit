---
"@okfit/core": minor
---

## Features

- New lint `generated-at-future` (config key `[lint] generated_at_future`, default `warn`). It fires on a `generated.at` more than 5 minutes later than now. A second message says when `okfit sync` will not re-stamp it, because re-stamping would make a verification count.
- New exports `GENERATED_AT_TOLERANCE`, `generatedAtIsFuture` and `verificationBlockingRestamp`.
- `ValidateOptions` takes a `configPath`, which messages that name the config file print.
- `OkfitConfig.read` reports every invalid key in one error, not only the first.

## Bug Fixes

- The `config-okf-version-stale` message names the config file. It no longer offers an unparsable version as the value to set.
