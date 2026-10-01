import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliExit } from "@effected/cli";
import { Now, OkfitPlatform } from "@okfit/engine";
import { ConfigProvider, DateTime, Effect, Option } from "effect";
import { initProgram } from "../../src/commands/init.js";
import type { InitConfigLocation } from "../../src/internal/initWizard.js";

/** A hermetic project directory plus the environment the platform reads (never the host's HOME/XDG). */
export interface InitProject {
	readonly cwd: string;
	readonly root: string;
}

export const makeInitProject = async (): Promise<InitProject> => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "okfit-init-wizard-")));
	const cwd = join(root, "cwd");
	await Promise.all(["cwd", "home", "xdg"].map((dir) => mkdir(join(root, dir), { recursive: true })));
	return { cwd, root };
};

export const removeInitProject = (project: InitProject): Promise<void> =>
	rm(project.root, { recursive: true, force: true });

/** `initProgram` with the platform, a fixed clock and a sandboxed environment provided. */
export const runInit = (
	project: InitProject,
	input: {
		readonly profile?: string;
		readonly bundle?: string;
		readonly configLocation?: InitConfigLocation;
	} = {},
) => {
	const env = {
		HOME: join(project.root, "home"),
		XDG_CONFIG_HOME: join(project.root, "xdg"),
		XDG_STATE_HOME: join(project.root, "xdg"),
		XDG_CACHE_HOME: join(project.root, "xdg"),
		XDG_DATA_HOME: join(project.root, "xdg"),
		NO_COLOR: "1",
	};
	return initProgram(
		{
			path: Option.none(),
			config: Option.none(),
			profile: Option.fromUndefinedOr(input.profile),
			bundle: Option.fromUndefinedOr(input.bundle),
			configLocation: Option.fromUndefinedOr(input.configLocation),
		},
		project.cwd,
	).pipe(
		Effect.provide(OkfitPlatform),
		Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
		Effect.provide(CliExit.layer),
		Effect.provideService(Now, DateTime.makeUnsafe("2026-10-01T00:00:00.000Z")),
	);
};

export const readText = (path: string): Promise<string> => readFile(path, "utf8");

export const exists = (path: string): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);
