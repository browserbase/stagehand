import "dotenv/config";
import { join } from "node:path";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
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
import { returnControl } from "./state.js";
import { BACKGROUND_CONTEXT, openAgent } from "./pi.js";
import { prompt } from "./scenario.js";

async function main() {
  checkCommand();
  if (["approve", "reject"].includes(command))
    throw new Error("Use return <decision-id> after completing Notion verification in Live View.");
  await exclusive(async () => {
    if (!(await savedId()) && command !== "start")
      throw new Error("No saved run. Use start first.");
    const { harness, store, browser } = await openAgent(
      await openNodeSqliteStorage(join(directory, "agent.sqlite")),
    );
    try {
      const root = await harness.root(BACKGROUND_CONTEXT, {
        agent: { model: { provider: "openai", modelId: process.env.AGENT_MODEL ?? "gpt-6-luna" } },
      });
      await saveJson(join(directory, "run.json"), { sessionId: String(root.id) });
      if (command === "cleanup") {
        await browser.stop(true);
        console.log(
          "Browser released. Agent history retained. Use a new STATE_DIR for a new login.",
        );
        return;
      }
      if (command === "return")
        await store.update((state) => {
          returnControl(state, decisionId!);
        });
      let state = await store.read();
      if (command !== "status" && state.decision?.status !== "pending" && !state.confirmed) {
        requireEnv("OPENAI_API_KEY");
        requireEnv("BROWSERBASE_API_KEY");
        const requestId = state.decision ? `return:${state.decision.id}` : "initial";
        const text = state.decision
          ? "The human returned control. Inspect the current page, then use read_workspace to finish listing visible workspace page links. Hand off again if verification is still needed."
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
          {
            decision: state.decision,
            browser: state.browser,
            confirmed: state.confirmed,
            workspace: state.workspace,
          },
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
      if (state.decision?.status === "pending") {
        await browser.liveLink();
        console.log(
          `Complete verification in Live View, then: pnpm start return ${state.decision.id}`,
        );
      }
      console.log(
        "Resume: pnpm start resume. Cleanup: pnpm start cleanup. Keep STATE_DIR unchanged.",
      );
    } finally {
      try {
        await browser.stop();
      } finally {
        await harness.close(BACKGROUND_CONTEXT);
      }
    }
  });
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
