declare const __STAGEHAND_SERVER_VERSION__: string;

const argv = process.argv.slice(1);
const normalizedArgv = argv[0]?.startsWith("--") ? argv : argv.slice(1);

if (normalizedArgv.includes("--version")) {
  console.log(__STAGEHAND_SERVER_VERSION__);
  process.exit(0);
}

void import("@browserbasehq/stagehand")
  .then(async ({ __internalMaybeRunShutdownSupervisorFromArgv }) => {
    if (__internalMaybeRunShutdownSupervisorFromArgv(normalizedArgv)) {
      return;
    }

    process.env.BROWSERBASE_FLOW_LOGS = "1";
    await import("./server.js");
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
