import { defineConfig } from "pluginfinity";

export default defineConfig({
	name: "okfit",
	description:
		"Teaches Claude Code the Open Knowledge Format (OKF) v0.2 and keeps a repository's okf/ knowledge bundle current through skills, one docs agent, and the okfit CLI and MCP server.",
	author: { name: "C. Spencer Beggs", url: "https://spencerbeg.gs" },
	homepage: "https://github.com/spencerbeggs/okfit",
	repository: "https://github.com/spencerbeggs/okfit.git",
	license: "MIT",
	hooks: {
		SessionStart: [{ script: "hooks/session-start/orientation.sh", timeout: 10 }],
		PostToolUse: [{ matcher: "Write|Edit", script: "hooks/post-tool-use/validate.sh", timeout: 30 }],
	},
	mcpServers: {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: pluginfinity placeholder
		mcp: { command: "sh", args: ["${PLUGIN_ROOT}/bin/start-mcp.sh"] },
	},
	lspServers: {
		okfit: {
			command: "sh",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: pluginfinity placeholder
			args: ["${PLUGIN_ROOT}/bin/start-lsp.sh", "--stdio"],
			extensionToLanguage: { ".md": "markdown" },
			diagnostics: true,
		},
	},
	claude: true,
	copilot: true,
});
