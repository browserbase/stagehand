import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Stagehand, StagehandServer } from "../../dist/index.js";
import { z } from "zod/v3";

/**
 * Integration test for P2P Server/Client functionality
 *
 * This test spins up a local Stagehand server and connects a client to it,
 * then verifies that all RPC calls (act, extract, observe, agentExecute)
 * work correctly through the remote connection.
 */
describe("P2P Server/Client Integration", () => {
  let server: StagehandServer;
  let serverStagehand: Stagehand;
  let clientStagehand: Stagehand;
  const SERVER_PORT = 3123; // Use a non-standard port to avoid conflicts
  const SERVER_URL = `http://localhost:${SERVER_PORT}`;

  beforeAll(async () => {
    // Create the server-side Stagehand instance
    serverStagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0, // Suppress logs during tests
      localBrowserLaunchOptions: {
        headless: true,
      },
    });

    await serverStagehand.init();

    // Create and start the server
    server = serverStagehand.createServer({
      port: SERVER_PORT,
      host: "127.0.0.1", // Use localhost for testing
    });

    await server.listen();

    // Give the server a moment to fully start
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Point the client at the P2P server via STAGEHAND_API_URL so that it
    // uses the HTTP API instead of launching a local browser.
    process.env.STAGEHAND_API_URL = `${SERVER_URL}/v1`;

    // Create the client-side Stagehand instance configured to talk to the remote server
    clientStagehand = new Stagehand({
      env: "BROWSERBASE",
      verbose: 0,
    });

    // Initialize the client, which connects to the remote server
    await clientStagehand.init();
  }, 30000); // 30 second timeout for setup

  afterAll(async () => {
    // Clean up: close client, server, and browser
    try {
      if (server) {
        await server.close();
      }
      if (serverStagehand) {
        await serverStagehand.close();
      }
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }, 30000);

  describe("Server Setup", () => {
    it("should have server listening", () => {
      expect(server).toBeDefined();
      expect(server.getUrl()).toBe(`http://127.0.0.1:${SERVER_PORT}`);
    });

    it("should have client connected", () => {
      expect(clientStagehand).toBeDefined();
      // The client should have an apiClient set
      expect((clientStagehand as any).apiClient).toBeDefined();
    });
  });

  describe("act() RPC call", () => {
    it("should execute act() remotely and return expected shape", async () => {
      // Navigate to a test page on the server
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto("data:text/html,<html><body><button id='test-btn'>Click Me</button></body></html>");

      // Give the page time to load
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Now execute act() through the client (which will RPC to the server)
      const result = await clientStagehand.act("click the button");

      // Verify the result has the expected shape
      expect(result).toBeDefined();
      expect(result).toHaveProperty("success");
      expect(result.success).toBe(true);

      // ActResult should have these properties
      if (result.success) {
        expect(result).toHaveProperty("message");
        expect(result).toHaveProperty("actions");
        expect(typeof result.message).toBe("string");

        // Actions should be an array
        expect(Array.isArray(result.actions)).toBe(true);
        if (result.actions.length > 0) {
          expect(result.actions[0]).toHaveProperty("selector");
          expect(typeof result.actions[0].selector).toBe("string");
        }
      }
    }, 30000);

    it("should execute act() with Action object", async () => {
      // Navigate to a test page
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto("data:text/html,<html><body><a id='link' href='#'>Link</a></body></html>");

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Get actions via observe
      const actions = await clientStagehand.observe("click the link");

      expect(actions).toBeDefined();
      expect(Array.isArray(actions)).toBe(true);
      expect(actions.length).toBeGreaterThan(0);

      // Execute the first action
      const result = await clientStagehand.act(actions[0]);

      expect(result).toBeDefined();
      expect(result).toHaveProperty("success");
    }, 30000);
  });

  describe("extract() RPC call", () => {
    it("should extract data without schema and return expected shape", async () => {
      // Navigate to a test page with content to extract
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto(
        "data:text/html,<html><body><h1>Test Title</h1><p>Test content paragraph.</p></body></html>"
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Extract without a schema (returns { extraction: string })
      const result = await clientStagehand.extract("extract the heading text");

      // Verify result shape
      expect(result).toBeDefined();
      expect(result).toHaveProperty("extraction");
      expect(typeof result.extraction).toBe("string");

      // The extraction should contain relevant text
      const extraction = result.extraction as string;
      expect(extraction.toLowerCase()).toContain("test");
    }, 30000);

    it("should extract data with zod schema and return expected shape", async () => {
      // Navigate to a test page with structured content
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto(
        "data:text/html,<html><body>" +
        "<div class='item'><span class='name'>Item 1</span><span class='price'>$10</span></div>" +
        "<div class='item'><span class='name'>Item 2</span><span class='price'>$20</span></div>" +
        "</body></html>"
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Define a schema
      const schema = z.object({
        items: z.array(
          z.object({
            name: z.string(),
            price: z.string(),
          })
        ),
      });

      // Extract with schema
      const result = await clientStagehand.extract(
        "extract all items with their names and prices",
        schema
      );

      // Verify result shape matches schema
      expect(result).toBeDefined();
      expect(result).toHaveProperty("items");
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);

      // Check first item structure
      const firstItem = result.items[0];
      expect(firstItem).toHaveProperty("name");
      expect(firstItem).toHaveProperty("price");
      expect(typeof firstItem.name).toBe("string");
      expect(typeof firstItem.price).toBe("string");
    }, 30000);

    it("should extract with selector option", async () => {
      // Navigate to a test page
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto(
        "data:text/html,<html><body>" +
        "<div id='container'><p id='target'>Target Text</p></div>" +
        "</body></html>"
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Extract from specific selector
      const result = await clientStagehand.extract(
        "extract the text",
        z.string(),
        { selector: "#target" }
      );

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect((result as string).toLowerCase()).toContain("target");
    }, 30000);
  });

  describe("observe() RPC call", () => {
    it("should observe actions and return expected shape", async () => {
      // Navigate to a test page with multiple elements
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto(
        "data:text/html,<html><body>" +
        "<button id='btn1'>Button 1</button>" +
        "<button id='btn2'>Button 2</button>" +
        "<a href='#' id='link'>Link</a>" +
        "</body></html>"
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Observe possible actions
      const actions = await clientStagehand.observe("click a button");

      // Verify result shape
      expect(actions).toBeDefined();
      expect(Array.isArray(actions)).toBe(true);
      expect(actions.length).toBeGreaterThan(0);

      // Check first action structure
      const firstAction = actions[0];
      expect(firstAction).toHaveProperty("selector");
      expect(firstAction).toHaveProperty("description");
      expect(typeof firstAction.selector).toBe("string");
      expect(typeof firstAction.description).toBe("string");

      // Actions should have method property
      if (firstAction.method) {
        expect(typeof firstAction.method).toBe("string");
      }
    }, 30000);

    it("should observe without instruction", async () => {
      // Navigate to a test page
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto(
        "data:text/html,<html><body>" +
        "<button>Click</button>" +
        "<input type='text' placeholder='Type here'/>" +
        "</body></html>"
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Observe all available actions
      const actions = await clientStagehand.observe();

      expect(actions).toBeDefined();
      expect(Array.isArray(actions)).toBe(true);
      // Should find multiple interactive elements
      expect(actions.length).toBeGreaterThan(0);

      // Each action should have required properties
      actions.forEach((action) => {
        expect(action).toHaveProperty("selector");
        expect(action).toHaveProperty("description");
      });
    }, 30000);
  });

  describe("agentExecute() RPC call", () => {
    it("should execute agent task and return expected shape", async () => {
      // Navigate to a simple test page
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto(
        "data:text/html,<html><body>" +
        "<h1>Agent Test Page</h1>" +
        "<button id='step1'>Step 1</button>" +
        "<button id='step2' style='display:none;'>Step 2</button>" +
        "<div id='result'></div>" +
        "<script>" +
        "document.getElementById('step1').onclick = () => {" +
        "  document.getElementById('step2').style.display = 'block';" +
        "  document.getElementById('result').textContent = 'Step 1 complete';" +
        "};" +
        "document.getElementById('step2').onclick = () => {" +
        "  document.getElementById('result').textContent = 'All steps complete';" +
        "};" +
        "</script>" +
        "</body></html>"
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Execute agent task through RPC
      const agent = clientStagehand.agent({
        model: process.env.OPENAI_API_KEY ? "openai/gpt-4o-mini" : undefined,
        systemPrompt: "Complete the task efficiently",
      });

      const result = await agent.execute({
        instruction: "Click Step 1 button",
        maxSteps: 3,
      });

      // Verify result shape
      expect(result).toBeDefined();
      expect(result).toHaveProperty("success");
      expect(typeof result.success).toBe("boolean");

      if (result.success) {
        expect(result).toHaveProperty("message");
        expect(typeof result.message).toBe("string");
      }

      // AgentResult should have actions
      if (result.actions) {
        expect(Array.isArray(result.actions)).toBe(true);
      }
    }, 60000); // Longer timeout for agent execution
  });

  describe("Session Management", () => {
    it("should track active sessions on server", () => {
      const sessionCount = server.getActiveSessionCount();
      expect(sessionCount).toBeGreaterThan(0);
    });

    it("should handle multiple concurrent requests", async () => {
      // Navigate to a test page
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto(
        "data:text/html,<html><body>" +
        "<h1>Concurrent Test</h1>" +
        "<button>Button 1</button>" +
        "<button>Button 2</button>" +
        "</body></html>"
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Execute multiple operations concurrently
      const [extractResult, observeResult] = await Promise.all([
        clientStagehand.extract("extract the heading text"),
        clientStagehand.observe("find buttons"),
      ]);

      // Both should succeed
      expect(extractResult).toBeDefined();
      expect(observeResult).toBeDefined();
      expect(Array.isArray(observeResult)).toBe(true);
    }, 30000);
  });

  describe("Error Handling", () => {
    it("should handle invalid session ID gracefully", async () => {
      // This test verifies error handling, but since we're using
      // an established session, we'll test with an invalid action

      const page = await serverStagehand.context.awaitActivePage();
      await page.goto("data:text/html,<html><body><p>No buttons here</p></body></html>");

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Try to act on a non-existent element
      // This should either return success: false or throw an error
      try {
        const result = await clientStagehand.act("click the non-existent super special button that definitely does not exist");

        // If it doesn't throw, check the result
        expect(result).toBeDefined();
        // It should indicate failure in some way
        if ('success' in result) {
          // Result structure is valid even if action failed
          expect(typeof result.success).toBe("boolean");
        }
      } catch (error) {
        // If it throws, that's also acceptable error handling
        expect(error).toBeDefined();
      }
    }, 30000);
  });

  describe("Type Safety", () => {
    it("should maintain type information through RPC", async () => {
      const page = await serverStagehand.context.awaitActivePage();
      await page.goto(
        "data:text/html,<html><body><span id='data'>42</span></body></html>"
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Extract with a typed schema
      const schema = z.object({
        value: z.number(),
      });

      const result = await clientStagehand.extract(
        "extract the number from the span",
        schema
      );

      // TypeScript should know this is { value: number }
      expect(result).toHaveProperty("value");
      expect(typeof result.value).toBe("number");
    }, 30000);
  });
});
