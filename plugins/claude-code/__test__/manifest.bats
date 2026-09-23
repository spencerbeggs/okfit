#!/usr/bin/env bats

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  MANIFEST="$PLUGIN_DIR/.claude-plugin/plugin.json"
  PKG="$PLUGIN_DIR/package.json"
}

@test "manifest is valid JSON named okfit" {
  run jq -r '.name' "$MANIFEST"
  [ "$status" -eq 0 ]
  [ "$output" = "okfit" ]
}

@test "manifest version matches package.json version" {
  manifest_version="$(jq -r '.version' "$MANIFEST")"
  package_version="$(jq -r '.version' "$PKG")"
  [ "$manifest_version" = "$package_version" ]
}

@test "tracking package is private" {
  run jq -r '.private' "$PKG"
  [ "$output" = "true" ]
}

@test "manifest registers the okfit LSP server through the sh shim with --stdio" {
  [ "$(jq -r '.lspServers.okfit.command' "$MANIFEST")" = "sh" ]
  [ "$(jq -r '.lspServers.okfit.args[0]' "$MANIFEST")" = '${CLAUDE_PLUGIN_ROOT}/bin/start-lsp.sh' ]
  [ "$(jq -r '.lspServers.okfit.args[1]' "$MANIFEST")" = "--stdio" ]
  [ "$(jq -r '.lspServers.okfit.extensionToLanguage[".md"]' "$MANIFEST")" = "markdown" ]
  [ "$(jq -r '.lspServers.okfit.diagnostics' "$MANIFEST")" = "true" ]
}
