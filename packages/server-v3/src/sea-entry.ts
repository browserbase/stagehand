import { __internalMaybeRunShutdownSupervisorFromArgv } from "@browserbasehq/stagehand";

// if SEA binary is launched with --supervisor, it will run the shutdown supervisor only
const argv = process.argv.slice(1);
const normalizedArgv = argv[0]?.startsWith("--") ? argv : argv.slice(1);

// otherwise, start the stagehand/server
if (!__internalMaybeRunShutdownSupervisorFromArgv(normalizedArgv)) {
  // Force flow logs on before the server module loads Stagehand core.
  process.env.BROWSERBASE_FLOW_LOGS = "1";
  void import("./server.js").catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
