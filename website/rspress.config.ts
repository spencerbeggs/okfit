import { defineConfig } from "@rspress/core";
import { ApiExtractorPlugin } from "rspress-plugin-api-extractor";

export default defineConfig({
	root: "content",
	title: "OKFit",
	description: "Node.js tooling for Google Open Knowledge Format agentic documentation system",
	outDir: "dist",
	llms: true,
	themeConfig: {
		llmsUI: {
			viewOptions: ["markdownLink", "chatgpt", "claude"],
			placement: "outline",
		},
	},
	siteOrigin: "https://okfit.dev",
	plugins: [
		ApiExtractorPlugin({
			apis: ApiExtractorPlugin.apis.fromDir("./lib/models"),
			observability: { logLevel: "info" },
		}),
	],
	route: {
		cleanUrls: true,
	},
});
