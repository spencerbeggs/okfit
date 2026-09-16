---
"@okfit/cli": minor
---

## Features

### Distribution-aware `main()`

`main()` now accepts an options object of the new exported `MainOptions` type:

```ts
import { main } from "@okfit/cli/main";

main({ distribution: { name: "@okfit/plugin", version: "0.3.7" } });
```

Passing a `distribution` threads it into every `--format json` envelope. Omit it (or call `main()` with no arguments) for a direct install of `@okfit/cli`, which reports `distribution: null`.

### `okfit --version` output

Widened to report every version that determines what a report says and what a config may contain:

```text
okfit 0.5.4 (engine 0.6.0, okf 0.2, config-schema 1.0)
okfit 0.5.4 via @okfit/plugin 0.3.7 (engine 0.6.0, okf 0.2, config-schema 1.0)
```

replacing the previous `okfit v<version>` form.
