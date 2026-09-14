---
"@okfit/profiles": minor
---

## Features

The `software-project` profile now sets `lint.status_missing = "warn"`, its first opinion on a lint severity. Projects using this profile are warned when a concept carries neither `status` nor a `verified` entry, rather than letting it silently read as `stable`.
