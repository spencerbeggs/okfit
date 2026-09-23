#!/usr/bin/env node

/**
 * The `okfit-lsp` bin, provided by the meta-package.
 *
 * @packageDocumentation
 */

import { main } from "@okfit/lsp/main";
import { PLUGIN_VERSION } from "../version.js";

await main({ distribution: { name: "@okfit/plugin", version: PLUGIN_VERSION } });
