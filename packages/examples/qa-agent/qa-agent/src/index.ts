const approach = process.argv[2] || "a";

if (approach === "a" || approach === "primitives") {
  console.log("Running Approach A: Primitives as Tools\n");
  await import("./approach-a/run.js");
} else if (approach === "b" || approach === "agent") {
  console.log("Running Approach B: Agent as Tool\n");
  await import("./approach-b/run.js");
} else {
  console.log("Usage: tsx src/index.ts [a|b]");
  console.log("  a / primitives  - Run with Stagehand primitives as individual tools");
  console.log("  b / agent       - Run with Stagehand agent as a single tool");
  process.exit(1);
}
