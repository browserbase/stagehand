import { StagehandServer } from "./index";

async function main(): Promise<void> {
  const server = new StagehandServer({ port: 3000 });
  try {
    await server.listen();
  } catch (error) {
    console.error("Failed to start Stagehand server:", error);
    process.exitCode = 1;
  }
}

void main();
