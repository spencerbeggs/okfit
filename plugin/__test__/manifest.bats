#!/usr/bin/env bats
# manifest.bats — the built manifests and server files for both hosts. The
# source of truth is pluginfinity.config.ts plus package.json's version;
# `pluginfinity build --check` proves builds/ matches them, and these pin
# the facts other code depends on.

setup() {
	PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
	BUILDS="$PLUGIN_DIR/builds"
	PKG="$PLUGIN_DIR/package.json"
}

@test "both manifests are named okfit" {
	[ "$(jq -r '.name' "$BUILDS/claude/.claude-plugin/plugin.json")" = "okfit" ]
	[ "$(jq -r '.name' "$BUILDS/copilot/plugin.json")" = "okfit" ]
}

@test "both manifests carry package.json's version" {
	local version
	version="$(jq -r '.version' "$PKG")"
	[ "$(jq -r '.version' "$BUILDS/claude/.claude-plugin/plugin.json")" = "$version" ]
	[ "$(jq -r '.version' "$BUILDS/copilot/plugin.json")" = "$version" ]
}

@test "tracking package is private" {
	[ "$(jq -r '.private' "$PKG")" = "true" ]
}

@test "Claude registers the okfit LSP server inline in plugin.json through the sh shim with --stdio" {
	local lsp="$BUILDS/claude/.claude-plugin/plugin.json"
	[ "$(jq -r '.lspServers.okfit.command' "$lsp")" = "sh" ]
	[ "$(jq -r '.lspServers.okfit.args[0]' "$lsp")" = '${CLAUDE_PLUGIN_ROOT}/bin/start-lsp.sh' ]
	[ "$(jq -r '.lspServers.okfit.args[1]' "$lsp")" = "--stdio" ]
	[ "$(jq -r '.lspServers.okfit.extensionToLanguage[".md"]' "$lsp")" = "markdown" ]
	[ "$(jq -r '.lspServers.okfit.diagnostics' "$lsp")" = "true" ]
	[ ! -e "$BUILDS/claude/.lsp.json" ]
}

@test "Copilot registers the okfit LSP server for .md" {
	local lsp="$BUILDS/copilot/com.github.copilot/lsp.json"
	[ "$(jq -r '.lspServers.okfit.args[0]' "$lsp")" = '${PLUGIN_ROOT}/bin/start-lsp.sh' ]
	[ "$(jq -r '.lspServers.okfit.fileExtensions[".md"]' "$lsp")" = "markdown" ]
}

@test "the MCP server is named mcp on both hosts, so its tools stay mcp__plugin_okfit_mcp__* on Claude" {
	[ "$(jq -r '.mcpServers.mcp.args[0]' "$BUILDS/claude/.claude-plugin/plugin.json")" = '${CLAUDE_PLUGIN_ROOT}/bin/start-mcp.sh' ]
	[ ! -e "$BUILDS/claude/.mcp.json" ]
	[ "$(jq -r '.mcpServers.mcp.args[0]' "$BUILDS/copilot/mcp.json")" = '${PLUGIN_ROOT}/bin/start-mcp.sh' ]
}

@test "Copilot agents reach this plugin's MCP tools as mcp/<tool>" {
	grep -qx -- '  - mcp/validate_bundle' "$BUILDS/copilot/com.github.copilot/agents/okf-docs.agent.md"
	grep -qx -- '  - mcp/validate_bundle' "$BUILDS/copilot/com.github.copilot/agents/okf-publisher.agent.md"
}
