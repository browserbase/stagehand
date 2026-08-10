#!/usr/bin/env node

import process from "node:process";
import { maybeRunShutdownSupervisorFromArgv } from "./shutdown/supervisor.js";

// currently the CLI is only used to spawn the shutdown supervisor
// in the future, we may want to add more CLI commands here
if (!maybeRunShutdownSupervisorFromArgv(process.argv.slice(2))) {
  console.error(
    "Unsupported stagehand CLI invocation. Expected --supervisor with valid args.",
  );
  process.exit(1);
}
