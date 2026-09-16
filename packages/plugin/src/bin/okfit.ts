#!/usr/bin/env node

/**
 * The `okfit` bin, provided by the meta-package.
 *
 * @packageDocumentation
 */

import { main } from "@okfit/cli/main";
import { PLUGIN_VERSION } from "../version.js";

main({ distribution: { name: "@okfit/plugin", version: PLUGIN_VERSION } });
