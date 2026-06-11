import { Stagehand } from "../lib/v3/index.js";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/",
    { waitUntil: "load" },
  );

  const tools = await page.listWebMCPTools();
  console.log(`Found ${tools.length} WebMCP tools:`);
  for (const tool of tools) {
    console.log(`- ${tool.name}: ${tool.description ?? "No description"}`);
  }

  const flightSearch = tools.find((tool) => tool.name === "searchFlights");
  if (flightSearch) {
    const invocation = await page.invokeWebMCPTool(
      flightSearch.name,
      {
        origin: "SFO",
        destination: "JFK",
        tripType: "round-trip",
        outboundDate: "2026-06-10",
        inboundDate: "2026-06-17",
        passengers: 1,
      },
      { frameId: flightSearch.frameId },
    );

    const result = await invocation.result;
    console.log("Invocation result:");
    console.log(JSON.stringify(result, null, 2));
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
  });
  try {
    await stagehand.init();
    await example(stagehand);
  } finally {
    await stagehand.close();
  }
})();
