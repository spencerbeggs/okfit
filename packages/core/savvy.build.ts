import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/core"],
		tsdoc: {
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				{ messageId: "ae-forgotten-export", pattern: "okfitConfigFields" },
			],
		},
	},
});
