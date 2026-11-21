---
"@okfit/ai-plugins": minor
---

## Features

The SessionStart hook compares the project's CLI to the minimum the plugin expects and adds one line to its context when the CLI is older, or too old to report `cli_version`. It stays silent when the CLI is supported.
