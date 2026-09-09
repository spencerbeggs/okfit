import { build } from "@savvy-web/bundler";

await build({
	meta: {
		tsdoc: {
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// `Now` (validate/run.ts) is deliberately not exported from the
				// barrel -- it means nothing outside a spawned process (K-49) --
				// but its type still appears in the inferred requirements of every
				// caller that reads it.
				{ messageId: "ae-forgotten-export", pattern: '"Now"' },
			],
		},
	},
});
