/**
 * Simple test script to verify Agent SDK works with agent-browser skill
 * Run with: npx tsx scripts/test-agent-browser.ts
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const HOME = os.homedir();
const SKILLS_DIR = path.join(HOME, "Documents/Browserbase/.agents/skills");

// Resolve Claude Code path (handle symlinks)
function getClaudeCodePath(): string {
  const symlinkPath = path.join(HOME, ".local", "bin", "claude");
  try {
    return fs.realpathSync(symlinkPath);
  } catch {
    return symlinkPath;
  }
}

async function main() {
  const claudeCodePath = getClaudeCodePath();
  console.log("Claude Code path:", claudeCodePath);
  console.log("Skills directory:", SKILLS_DIR);

  // Simple task: go to example.com and get the page title
  const instruction = `
    Use agent-browser to:
    1. Open https://example.com
    2. Get a snapshot of the page
    3. Tell me what elements are on the page
    4. Close the browser
  `;

  console.log("\n=== Starting Agent SDK query ===\n");
  console.log("Instruction:", instruction.trim());
  console.log("\n---\n");

  try {
    for await (const message of query({
      prompt: instruction,
      options: {
        model: "claude-sonnet-4-5-20250929",
        allowedTools: ["Bash"],
        maxTurns: 10,
        maxBudgetUsd: 1.0,
        cwd: path.join(SKILLS_DIR, "agent-browser"),
        pathToClaudeCodeExecutable: claudeCodePath,
      },
    })) {
      // Print each message as it comes
      if (message.type === "assistant") {
        if (message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") {
              console.log("[Assistant]", block.text);
            } else if (block.type === "tool_use") {
              console.log(`[Tool: ${block.name}]`, JSON.stringify(block.input).substring(0, 200));
            }
          }
        }
      } else if (message.type === "result") {
        console.log("\n=== Result ===");
        console.log("Success:", !(message as any).is_error);
        console.log("Turns:", (message as any).num_turns);
        console.log("Cost: $" + ((message as any).cost_usd ?? 0).toFixed(4));
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
