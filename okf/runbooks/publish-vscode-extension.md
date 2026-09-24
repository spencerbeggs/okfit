---
type: Runbook
title: Publish the VS Code extension
description: Cut a release of @okfit/vscode-extension and confirm it reaches the Visual Studio Marketplace, Open VSX and the GitHub release.
status: draft
resource: ../../.github/workflows/vscode-marketplace.yml
tags:
  - release
  - ci
generated:
  by: okfit/claude-code
  at: 2026-09-23T18:05:30Z
  body_sha256: 5b7b7c07074e6c7987affe0817b33e0f02925c6959f371d78d1fd95911ebba63
---

# Publish the VS Code extension

## Trigger

A merged changeset for `@okfit/vscode-extension` produces the tag
`@okfit/vscode-extension@X.Y.Z` and a GitHub release; the `release`
`published` event is what starts the `VS Code Marketplace` workflow
(`.github/workflows/vscode-marketplace.yml:3-5,24`).

## Steps

1. Merge the release PR that changesets opened. The release action tags
   `@okfit/vscode-extension@X.Y.Z` and publishes the GitHub release, which
   fires the workflow.
2. Watch the `VS Code Marketplace` workflow run in the Actions tab. It
   asserts the tag matches `vscode/package.json`'s `version`
   (`lib/assert-version.sh`), builds `@okfit/lsp` and the extension,
   packages `okfit.vsix` (`vsce package --no-dependencies`), attaches it
   to the release, then publishes to the Marketplace and Open VSX.
3. On failure, re-run the workflow by hand with `workflow_dispatch`,
   passing the same tag (`@okfit/vscode-extension@X.Y.Z`) and `dry_run:
   false`. The workflow is idempotent: `vsce publish`/`ovsx publish` both
   run with `--skip-duplicate`, so a re-run after a partial failure never
   double-publishes a version already live.
4. Verify: the new version shows at
   `https://marketplace.visualstudio.com/items?itemName=okfit.okfit` and
   `https://open-vsx.org/extension/okfit/okfit`, and `okfit.vsix` is
   attached to the GitHub release.

## Repository configuration

| Name | Kind | Purpose |
| :-- | :-- | :-- |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | variables | Microsoft Entra ID workload identity federation for `vsce publish --azure-credential` (the recommended path; Azure DevOps global PATs retire on 2026-12-01) |
| `VSCE_PAT` | secret | Fallback: a Marketplace **Manage** PAT. When set, the workflow uses it instead of federation. |
| `OVSX_PAT` | secret | Open VSX access token for the `okfit` namespace |

The Marketplace publisher `okfit` and the Open VSX namespace `okfit` must
exist before the first publish.

## Dry run

Run the workflow by hand with `workflow_dispatch`, a `tag` naming an
existing (or not-yet-released) version, and `dry_run: true`
(the default). The workflow packages the extension and attaches the
artifact for download, but skips both `vsce publish` and `ovsx publish`
entirely (`DRY_RUN` gates the Azure login step and both publish steps) --
nothing reaches the Marketplace or Open VSX.

## Observable end state

The released version is installable from the Marketplace and from Open
VSX, and `okfit.vsix` is attached to the matching GitHub release.

## Links

- [VS Code Extension](../modules/vscode-extension.md)
