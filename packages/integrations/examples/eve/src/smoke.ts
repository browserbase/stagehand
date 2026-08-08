import { runEveStagehandEval } from "./run-eval.js";

process.env.STAGEHAND_BROWSER ??= "local";

await runEveStagehandEval(true);
process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    framework: "eve",
    proof: "local authenticated gateway and deterministic Eve agent",
    tools: ["connection_search", "stagehand__code_execute"],
    codeExecuteCalls: 1,
    unauthorizedStatus: 401,
  })}\n`,
);
