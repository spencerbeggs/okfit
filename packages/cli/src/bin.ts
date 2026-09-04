#!/usr/bin/env node

/**
 * CLI entry point for okfit.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { CLI_VERSION, rootCommand } from "./index.js";

const cli = Command.run(rootCommand, { version: CLI_VERSION });

NodeRuntime.runMain(cli.pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<void>);
