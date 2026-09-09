import { resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Run } from "@effected/commands";
import { Effect, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

const binDir = resolve(import.meta.dirname, "..", "..", "dist", "dev", "pkg", "bin");

/**
 * `stdin` is a `ChildProcess.CommandOptions` field, NOT a `Run.collect`
 * option -- `@effected/commands` deliberately routes cwd, env and stdin
 * through core's command vocabulary rather than re-declaring them. Its type
 * is `CommandInput`, which does not accept a string:
 * `"pipe" | "inherit" | "ignore" | "overlapped" | Stream<Uint8Array, PlatformError>`
 * (`ChildProcess.ts:146-158`). Encode to bytes and wrap in a Stream; stdin
 * closes when the stream ends, which is what makes the server exit.
 *
 * `env` is passed whole and `extendEnv` is never set, so `PATH` and `HOME`
 * must be listed explicitly -- same contract as the cli e2e helper.
 */
const runBin = (name: string, args: ReadonlyArray<string>, stdin?: string) =>
	Run.collect(
		ChildProcess.make(process.execPath, [resolve(binDir, name), ...args], {
			env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1" },
			...(stdin === undefined ? {} : { stdin: Stream.make(new TextEncoder().encode(stdin)) }),
		}),
	);

describe("@okfit/plugin bins", () => {
	it.effect("the okfit bin runs and reports a version", () =>
		Effect.gen(function* () {
			const result = yield* runBin("okfit.js", ["--version"]);
			assert.match(result.stdout.trim(), /^okfit v\d+\.\d+\.\d+/);
			assert.strictEqual(result.exitCode, 0);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("the okfit-mcp bin completes an initialize handshake on stdout", () =>
		Effect.gen(function* () {
			const request = `${JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "okfit-plugin-e2e", version: "0.0.0" },
				},
			})}\n`;
			const result = yield* runBin("okfit-mcp.js", [], request);
			// The server answers on stdout and must keep logs off that wire.
			assert.include(result.stdout, '"jsonrpc":"2.0"');
			assert.include(result.stdout, '"serverInfo"');
			// A clean stdin close is exit 0, not 130.
			assert.strictEqual(result.exitCode, 0);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
