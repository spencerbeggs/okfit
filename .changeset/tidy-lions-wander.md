---
"@okfit/mcp": minor
---

## Features

### Distribution-aware server and `main()`

`ServerLayer` accepts a new optional second argument of the new exported `ServerOptions` type, and `main()` accepts the new exported `MainOptions` type — both carry an optional `distribution: { name, version }` threaded into `validate_bundle`'s rendered envelope:

```ts
import { ServerLayer } from "@okfit/mcp";

ServerLayer(projectRoot, { distribution: { name: "@okfit/plugin", version: "0.3.7" } });
```

Both options are optional and default to no distribution, so existing callers are unaffected.
