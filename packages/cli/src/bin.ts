#!/usr/bin/env node

/**
 * CLI entry point for okfit.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CliLogger, CliRuntime } from "@effected/cli";
import { AppDirs, Xdg } from "@effected/xdg";
import { DateTime, Effect, Layer, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { rootCommand } from "./commands/root.js";
import { renderFailure } from "./errors.js";
import { Now } from "./validate/run.js";
import { CLI_VERSION } from "./version.js";

/**
 * K-9: `AppConfig.layer` only, built by Group B's `config/layer.ts` —
 * `Xdg` and `AppDirs` are provided once, here, for both commands; no
 * `Store`, no `Cache`, so no `store.db`/`cache.db` is ever created.
 *
 * `AppDirs.layer(options)` requires `Xdg | FileSystem | Path`
 * (`XDG/index.d.ts:320`), so `Layer.provide(Xdg.layer)` alone does not close
 * it: `Layer.provideMerge(NodeServices.layer)` supplies `FileSystem`/`Path`
 * to both members and keeps every service in the output. `NodeServices.layer`
 * provides `ChildProcessSpawner | Crypto | FileSystem | Path | Stdio |
 * Terminal`, a superset of `Command.Environment`.
 *
 * `Xdg.layer` fails with `XdgEnvError` when `HOME` is unset (K-13). That
 * error reaches `reportFailures` and takes its `exitCode: 3` fallback, with
 * no special case anywhere.
 */
const PlatformLayer = Layer.mergeAll(
	Xdg.layer,
	AppDirs.layer({ namespace: "okfit" }).pipe(Layer.provide(Xdg.layer)), // K-11
).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * K-47: an ISO-8601 `OKFIT_NOW` when set, else the wall clock. A documented
 * test hook, not user-facing. Resolved exactly once, here, and provided to
 * the whole command tree through the `Now` tag so no command handler ever
 * reads `process.env["OKFIT_NOW"]` itself.
 */
const nowEffect = Option.fromNullishOr(process.env["OKFIT_NOW"]).pipe(
	Option.flatMap((iso) => DateTime.make(iso)),
	Option.match({ onNone: () => DateTime.now, onSome: Effect.succeed }),
);

const program = Effect.gen(function* () {
	const now = yield* nowEffect;
	return yield* Command.run(rootCommand, { version: CLI_VERSION }).pipe(
		Effect.provideService(Now, now),
		// K-7/K-30: `ShowHelp` carries its own exit code — 0 with no errors, 1 with
		// parse errors. Remap only the second to 64 (BSD EX_USAGE);
		// `CliRuntime.reported` is the kit's own marker helper and also sets
		// `Runtime.errorReported`, whose polarity is inverted.
		Effect.catchTag("ShowHelp", (help) => Effect.fail(CliRuntime.reported(help, help.errors.length > 0 ? 64 : 0))),
		// K-30. `renderFailure` returns `[]` for a `ShowHelp`, because
		// `Command.runWith` already rendered the help document. The `exitCode: 3`
		// fallback is the infrastructure tier for any typed error that carries no
		// code of its own.
		CliRuntime.reportFailures({ exitCode: 3, render: renderFailure }),
	);
});

NodeRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(CliLogger.layer(), PlatformLayer))));
