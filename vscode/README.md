# okfit

Diagnostics, navigation and a concept explorer for [Open Knowledge
Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(OKF) bundles, powered by the
[`@okfit/lsp`](https://www.npmjs.com/package/@okfit/lsp) language server.

> **Preview.** This extension is early: today it only scaffolds the
> workspace and activates on an okfit config file. Language features land
> in later releases.

## What it is

`okfit` bundles the okfit language server directly into the extension, so
installing it from the Marketplace needs no separate global install. It
activates when a workspace contains a `.okfit.toml`, `okfit.toml`, or
`.config/okfit.toml` file.

## Development

```bash
pnpm --filter @okfit/vscode-extension build
```

Then launch the "Run okfit extension" configuration from VS Code's Run and
Debug view.
