import "dotenv/config";
import { Terminal } from "./terminal.js";
import { join } from "node:path";
import { createWorld } from "@workflow/world-local";
import { acquireHarness, resumeWith } from "durable-harness/pi-durable";
import { registerQueue } from "durable-harness";
import {
  command,
  checkCommand,
  decisionId,
  directory,
  exclusive,
  requireEnv,
  saveJson,
  savedId,
} from "./cli.js";
import { decide, approveOrder } from "./state.js";
import { BACKGROUND_CONTEXT, openAgent } from "./pi.js";
import { reviewOrder } from "./review.js";
import { prompt } from "./scenario.js";

async function main() {
  checkCommand();
  const terminal = new Terminal({
    enabled: ["start", "resume"].includes(command) ? undefined : false,
  });
  try {
    await exclusive(async () => {
      if (!(await savedId()) && command !== "start")
        throw new Error("No saved run. Use start first.");
      const world = createWorld({ dataDir: join(directory, "world"), recoverActiveRuns: false });
      const opened = new Map<
        Awaited<ReturnType<typeof openAgent>>["harness"],
        Awaited<ReturnType<typeof openAgent>>
      >();
      const open = resumeWith(
        async (storage) => {
          const agent = await openAgent(storage);
          opened.set(agent.harness, agent);
          return agent.harness;
        },
        { world, name: "order-approval" },
      );
      registerQueue(world);
      const lease = await acquireHarness(await savedId(), open, { world, name: "order-approval" });
      const { harness, store, browser } = opened.get(lease.harness)!;
      try {
        const root = await harness.root(BACKGROUND_CONTEXT, {
          agent: {
            model: {
              provider: "openai",
              modelId: process.env.AGENT_MODEL ?? "gpt-6-luna",
            },
          },
        });
        await saveJson(join(directory, "run.json"), { sessionId: lease.storage.sessionId });
        if (command === "cleanup") {
          await browser.stop(true);
          console.log(
            "Browser released. Agent history retained. Use a new STATE_DIR for a new order.",
          );
          return;
        }
        if (command === "return")
          await store.update((state) => {
            if (state.decision?.status !== "approved" && state.decision?.status !== "returned")
              throw new Error("Approve the saved values before returning control.");
            decide(state, decisionId!, "returned");
          });
        if (command === "reject")
          await store.update((state) => {
            decide(state, decisionId!, "rejected");
          });
        if (command === "approve") {
          const state = await store.read();
          if (!state.decision || state.decision.id !== decisionId)
            throw new Error("Unknown decision ID");
          const actual = await browser.formValues();
          await store.update((draft) => {
            approveOrder(draft, decisionId!, actual);
          });
        }
        while (true) {
          let state = await store.read();
          if (
            !["status", "approve", "reject"].includes(command) &&
            !["pending", "approved", "rejected"].includes(state.decision?.status ?? "") &&
            !state.confirmed
          ) {
            requireEnv("OPENAI_API_KEY");
            requireEnv("BROWSERBASE_API_KEY");
            const requestId = state.decision ? `return:${state.decision.id}` : "initial";
            const text = state.decision
              ? "The human returned control after submitting the approved order. Use verify_order. If confirmation cannot be established, report uncertainty and never submit again."
              : prompt;
            await (
              await root.submit({ type: "input", content: text, requestId }, BACKGROUND_CONTEXT)
            ).wait(BACKGROUND_CONTEXT);
            await root.waitForIdle(BACKGROUND_CONTEXT);
            state = await store.read();
          }
          await saveJson(join(directory, "status.json"), state);
          console.log(
            JSON.stringify(
              { decision: state.decision, browser: state.browser, confirmed: state.confirmed },
              null,
              2,
            ),
          );
          if (
            command !== "status" &&
            !state.confirmed &&
            state.decision?.status !== "pending" &&
            state.decision?.status !== "approved" &&
            state.decision?.status !== "rejected"
          )
            process.exitCode = 2;
          if (command === "status") break;
          if (await reviewOrder(store, browser, terminal)) continue;
          await saveJson(join(directory, "status.json"), await store.read());
          if ((await store.read()).confirmed)
            console.log("Matching confirmation verified. Cleanup: pnpm start cleanup.");
          console.log(
            "Resume: pnpm start resume. Cleanup: pnpm start cleanup. Keep STATE_DIR unchanged.",
          );
          break;
        }
      } finally {
        try {
          await browser.stop();
        } finally {
          try {
            await lease.release();
          } finally {
            await world.close?.();
          }
        }
      }
    });
  } finally {
    terminal.close();
  }
}

main().then(
  () => {
    process.stdout.write("", () => process.exit(process.exitCode ?? 0));
  },
  (error) => {
    console.error(error instanceof Error ? error.message : "Run failed");
    process.exit(1);
  },
);
