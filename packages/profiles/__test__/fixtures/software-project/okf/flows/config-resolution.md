---
type: Flow
status: stable
title: Config resolution
description: How a config file is found, merged, and handed to a command.
x-okfit-entry: ../../src/Config.ts
x-okfit-crosses: [../modules/core.md]
resource: ../../src/Config.ts
tags: [config]
---

# Config resolution

The command asks core for the merged config; core walks up from the working directory, merges the profile, and returns it. Failure mode: a malformed file surfaces as a config error before any command runs.
