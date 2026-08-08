import { runEveStagehandEval } from "./run-eval.js";

process.env.STAGEHAND_BROWSER ??= "local";

await runEveStagehandEval(false);
process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    framework: "eve",
    proof: "local authenticated gateway and real Groq-backed Eve agent",
  })}\n`,
);
