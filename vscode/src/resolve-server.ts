import { join } from "node:path";

export type ServerLaunch =
	| {
			readonly kind: "command";
			readonly command: string;
			readonly args: ReadonlyArray<string>;
			readonly source: "setting" | "workspace";
	  }
	| { readonly kind: "module"; readonly module: string; readonly source: "bundled" };

export interface ResolveInput {
	readonly settingPath: string | undefined;
	readonly folders: ReadonlyArray<string>;
	readonly bundledModule: string;
	readonly exists: (path: string) => boolean;
}

export interface Resolution {
	readonly launch: ServerLaunch;
	readonly notes: ReadonlyArray<string>;
}

/** First hit wins: the setting, then each folder's local bin, then the bundled server. Pure. */
export const resolveServer = (input: ResolveInput): Resolution => {
	const notes: Array<string> = [];
	const setting = input.settingPath?.trim();
	if (setting !== undefined && setting !== "") {
		if (input.exists(setting)) {
			return { launch: { kind: "command", command: setting, args: ["--stdio"], source: "setting" }, notes };
		}
		notes.push(`okfit.lsp.serverPath is set to ${setting}, which does not exist; falling back.`);
	}
	for (const folder of input.folders) {
		const local = join(folder, "node_modules", ".bin", "okfit-lsp");
		if (input.exists(local)) {
			return { launch: { kind: "command", command: local, args: ["--stdio"], source: "workspace" }, notes };
		}
	}
	return { launch: { kind: "module", module: input.bundledModule, source: "bundled" }, notes };
};
