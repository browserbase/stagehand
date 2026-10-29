import "dotenv/config";
import { Terminal } from "./terminal.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
  command,
  checkCommand,
  decisionId,
  directory,
  exclusive,
  requireEnv,
  saveJson,
} from "./cli.js";
import { decide, approveOrder, progress } from "./state.js";
import { BACKGROUND_CONTEXT, openAgent } from "./pi.js";
import { reviewOrder } from "./review.js";
import { prompt } from "./scenario.js";

async function main() {
  checkCommand();
  const terminal = new Terminal(["start", "resume"].includes(command));
  try {
    await exclusive(async () => {
      const database = join(directory, "agent.sqlite");
      if (!existsSync(database)) {
        if (command !== "start") throw new Error("No saved SQLite run. Use start first.");
        if (existsSync(join(directory, "run.json")))
          throw new Error(
            "This directory contains an older World-backed run. Use a new STATE_DIR.",
          );
      }
      const { harness, store, browser } = await openAgent(await openNodeSqliteStorage(database));
      try {
        const root = await harness.root(BACKGROUND_CONTEXT, {
          agent: {
            model: {
              provider: "openai",
              modelId: process.env.AGENT_MODEL ?? "gpt-6-luna",
            },
          },
        });
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
          const status = { ...state, progress: progress(state) };
          await saveJson(join(directory, "status.json"), status);
          console.log(JSON.stringify(command === "status" ? status : state, null, 2));
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
          state = await store.read();
          await saveJson(join(directory, "status.json"), { ...state, progress: progress(state) });
          if (state.confirmed)
            console.log(
              "Matching confirmation verified. Cleanup: pnpm --filter stagehand-cookbook-pi-durable-approval start cleanup.",
            );
          console.log(
            "Resume: pnpm --filter stagehand-cookbook-pi-durable-approval start resume. Cleanup: pnpm --filter stagehand-cookbook-pi-durable-approval start cleanup. Keep STATE_DIR unchanged.",
          );
          break;
        }
      } finally {
        try {
          await browser.stop();
        } finally {
          await harness.close(BACKGROUND_CONTEXT);
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
