# Badge formats

Load when: writing or normalizing a badge block.

## shields.io templates

- npm: `https://img.shields.io/npm/v/<encoded-name>?label=npm&color=cb3837`,
  linking to `https://www.npmjs.com/package/<name>`.
- License: `https://img.shields.io/badge/License-<license>-4caf50.svg`
  (color depends on the license family -- see the table below), linking to
  `https://opensource.org/licenses/<license>`.
- Runtime (Node.js):
  `https://img.shields.io/badge/Node.js-<encoded-engineRange>-5fa04e.svg`,
  linking to `https://nodejs.org/`.
- Runtime (Bun):
  `https://img.shields.io/badge/Bun-<encoded-engineRange>-f9f1e1.svg?logo=bun&logoColor=000000`,
  linking to `https://bun.sh/`.
- Runtime (Deno):
  `https://img.shields.io/badge/Deno-<encoded-engineRange>-000000.svg`,
  linking to `https://deno.com/`.
- TypeScript: `https://img.shields.io/badge/TypeScript-<tsVersion>-3178c6.svg`,
  linking to `https://www.typescriptlang.org/`.

## License color table

- `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `Unlicense` --
  `4caf50` (green).
- `GPL-3.0`, `AGPL-3.0`, `LGPL-3.0` -- `f57c00` (amber, signals attention).
- `UNLICENSED` or proprietary -- `9e9e9e` (grey).

## Skip logic

| Badge | Skip when |
| --- | --- |
| Runtime | `package.json` has no `engines` field, or its value is `*`, `>=0`, or empty |
| TypeScript | neither `devDependencies.typescript` nor `dependencies.typescript` is present |
| npm | never -- every publishable `package.json` carries `name` |
| License | never -- every publishable `package.json` carries `license` |

## URL encoding rules

- `@scope/pkg` -> `@scope%2Fpkg` in shields.io path segments; the bare `@`
  stays unescaped.
- `>=20` -> `%3E%3D20`.
- Whitespace in a version range -> `%20`.

## Worked example

For `{ name: "@okfit/cli", license: "MIT", runtime: "node", engineRange:
">=20", tsVersion: "5.6" }`:

```markdown
[![npm](https://img.shields.io/npm/v/@okfit%2Fcli?label=npm&color=cb3837)](https://www.npmjs.com/package/@okfit/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D20](https://img.shields.io/badge/Node.js-%3E%3D20-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 5.6](https://img.shields.io/badge/TypeScript-5.6-3178c6.svg)](https://www.typescriptlang.org/)
```
