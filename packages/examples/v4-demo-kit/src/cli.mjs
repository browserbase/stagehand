import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSession } from "./session.mjs";
import { createDemoTools, TOOL_DEFINITIONS } from "./tools.mjs";

const command = process.argv[2];

if (!command) {
  printMenu();
} else if (command === "tools") {
  await runToolsDemo();
} else if (command === "hybrid") {
  await runHybridDemo();
} else if (command === "script") {
  await runScript(process.argv[3]);
} else {
  throw new Error(`Unknown demo: ${command}`);
}

function printMenu() {
  console.log(`
Stagehand v4 demo kit

1. npm run demo:agent -- "your browser task"
   Let an agent choose Stagehand tools during the run.

2. npm run demo:tools
   Show persistent, Playwright-shaped tools that an agent can call on demand.

3. npm run demo:hybrid
   Mix exact browser control with self-healing AI methods.

4. npm run demo:script
   Run one reusable task script.

5. npm run serve
   Expose the registered script through a protected HTTP endpoint.
`);
}

async function runToolsDemo() {
  console.log("Tools available to the agent:");
  console.log(TOOL_DEFINITIONS.map(({ name, description }) => ({ name, description })));
  const session = await createSession();
  try {
    const tools = createDemoTools(session);
    const result = await tools.call({
      name: "run",
      input: {
        code: `
          await page.goto("https://example.com");
          return {
            title: await page.title(),
            heading: await page.locator("h1").innerText(),
          };
        `,
      },
    });
    console.log("One run tool call:", result);
    const snapshot = await tools.call({ name: "snapshot", input: {} });
    console.log("Snapshot:", snapshot);
    const learnMoreId = snapshot.match(/\[([^\]]+)\] link: Learn more/i)?.[1];
    if (!learnMoreId) throw new Error("The snapshot did not include the Learn more link.");
    console.log(
      "Snapshot action:",
      await tools.call({
        name: "run",
        input: { actions: [{ op: "click", id: learnMoreId }] },
      }),
    );
    console.log(
      "Screenshot:",
      await tools.call({ name: "screenshot", input: { fullPage: false } }),
    );
  } finally {
    await session.close();
  }
}

async function runHybridDemo() {
  const session = await createSession({ requireModel: true });
  try {
    await session.page.goto("https://www.stagehand.dev/");
    const { data: actions, metadata: observeMetadata } = await session.stagehand.observe(
      "Find the link or button that opens the Stagehand documentation.",
    );
    if (!actions[0]) throw new Error("Stagehand did not find a documentation action.");

    console.log("AI found this action:", actions[0]);
    console.log("Observe metadata:", observeMetadata);
    await session.stagehand.act(actions[0]);
    console.log("Exact page title:", await session.page.title());

    const { data, metadata: extractMetadata } = await session.stagehand.extract(
      "Extract only the exact visible main heading. Do not infer or add other text.",
      (await import("zod/v4")).z.object({
        heading: (await import("zod/v4")).z.string(),
      }),
    );
    console.log("Typed result:", data);
    console.log("Extract metadata:", extractMetadata);
  } finally {
    await session.close();
  }
}

export async function runScript(scriptPath) {
  if (!scriptPath) {
    throw new Error("Give one script path. Example: npm run run:script -- scripts/my-task.mjs");
  }
  const absolutePath = resolve(scriptPath);
  const module = await import(pathToFileURL(absolutePath).href);
  if (typeof module.run !== "function") {
    throw new Error("The script must export an async run function.");
  }

  const session = await createSession({ requireModel: module.needsModel !== false });
  try {
    const result = await module.run(session);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await session.close();
  }
}
