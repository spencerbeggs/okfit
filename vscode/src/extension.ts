import { defineExtension, defineLogger } from "reactive-vscode";

// reactive-vscode@1.0.2 ships defineLogger, not the useLogger name the extension
// used before it: defineLogger(name) builds a LogOutputChannel-backed logger,
// usable before activation, and is what the F5 probe (Task 1 Step 8) reads.
const logger = defineLogger("okfit");

export const { activate, deactivate } = defineExtension(() => {
	logger.info(
		`okfit extension activated on Node ${process.versions.node}, Electron ${process.versions.electron ?? "n/a"}`,
	);
});
