import { Worker } from "@temporalio/worker";
import * as activities from "./research-activities";

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve("./workflows"),
    activities,
    taskQueue: "browser-automation",
    maxConcurrentActivityTaskExecutions: 2,
  });

  // Handle worker shutdown gracefully
  process.on("SIGINT", async () => {
    worker.shutdown();
    process.exit(0);
  });

  await worker.run();
}

run().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
