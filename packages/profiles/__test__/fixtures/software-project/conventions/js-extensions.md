---
type: Convention
title: Relative imports end in .js
description: Every relative import in a TypeScript source file carries a .js extension.
stale_after: 2027-03-01T00:00:00Z
---

# Relative imports end in .js

Write `import { x } from "./x.js"`, never `"./x"`. Node built-ins use the `node:` prefix.
