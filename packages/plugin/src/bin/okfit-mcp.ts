#!/usr/bin/env node

/**
 * The `okfit-mcp` bin, provided by the meta-package.
 *
 * @packageDocumentation
 */

import { main } from "@okfit/mcp/main";
import { PLUGIN_VERSION } from "../version.js";

await main({ distribution: { name: "@okfit/plugin", version: PLUGIN_VERSION } });
