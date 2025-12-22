/**
 * Integration tests for StagehandAPIClient against a running server.
 *
 * These tests require:
 * - A running Stagehand server at STAGEHAND_API_URL (default: http://localhost:3000)
 * - Valid credentials in environment variables:
 *   - BROWSERBASE_API_KEY
 *   - BROWSERBASE_PROJECT_ID
 *   - OPENAI_API_KEY (or other model API key)
 *
 * Run with:
 *   STAGEHAND_API_URL=http://localhost:3000 pnpm run test:integration
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { Api } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import path from "path";

// Load .env from repo root (packages/server/test -> repo root = 3 levels up)
const repoRootEnvPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: repoRootEnvPath });
// Also try local .env
dotenv.config();

const STAGEHAND_API_URL =
  process.env.STAGEHAND_API_URL || "http://localhost:3000";
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
const MODEL_API_KEY = process.env.OPENAI_API_KEY;

// Skip all tests if required env vars are not set
const canRun = BROWSERBASE_API_KEY && BROWSERBASE_PROJECT_ID && MODEL_API_KEY;

describe.skipIf(!canRun)(
  "StagehandAPIClient integration tests",
  { timeout: 120_000 },
  () => {
    let sessionId: string | null = null;

    const headers = {
      "Content-Type": "application/json",
      "x-bb-api-key": BROWSERBASE_API_KEY!,
      "x-bb-project-id": BROWSERBASE_PROJECT_ID!,
      "x-model-api-key": MODEL_API_KEY!,
      "x-language": "typescript",
      "x-stream-response": "false",
      "x-sdk-version": "3.0.0",
    };

    async function apiRequest(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<Response> {
      const url = `${STAGEHAND_API_URL}/v1${path}`;
      return fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    }

    beforeAll(() => {
      if (!canRun) {
        console.log(
          "Skipping integration tests - missing required environment variables",
        );
        console.log(
          "Required: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, OPENAI_API_KEY",
        );
        console.log(
          "Optional: STAGEHAND_API_URL (default: http://localhost:3000)",
        );
      }
    });

    afterAll(async () => {
      // Clean up session if one was created
      if (sessionId) {
        try {
          await apiRequest("POST", `/sessions/${sessionId}/end`);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    test("POST /sessions/start creates a session", async () => {
      const res = await apiRequest("POST", "/sessions/start", {
        modelName: "openai/gpt-4o-mini",
      });

      const body = await res.json();
      console.log("Status:", res.status);
      console.log("Response body:", JSON.stringify(body, null, 2));

      expect(res.status).toBe(200);

      const parsed = Api.SessionStartResponseSchema.safeParse(body);
      if (!parsed.success) {
        console.log("Parse errors:", parsed.error.issues);
      }
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.success).toBe(true);
        expect(parsed.data.data.sessionId).toBeTruthy();
        sessionId = parsed.data.data.sessionId;
      }
    });

    test("POST /sessions/:id/navigate navigates to a URL", async () => {
      expect(sessionId).toBeTruthy();

      const res = await apiRequest("POST", `/sessions/${sessionId}/navigate`, {
        url: "https://example.com",
        frameId: "", // Required for V3, empty string uses active page
      });

      if (res.status !== 200) {
        const errBody = await res.json();
        console.log("Navigate status:", res.status);
        console.log("Navigate error:", JSON.stringify(errBody, null, 2));
      }
      expect(res.status).toBe(200);

      const body = await res.json();
      const parsed = Api.NavigateResponseSchema.safeParse(body);
      if (!parsed.success) {
        console.log("Navigate body:", JSON.stringify(body, null, 2));
        console.log("Navigate parse errors:", parsed.error.issues);
      }
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.success).toBe(true);
      }
    });

    test("POST /sessions/:id/extract extracts data from page", async () => {
      expect(sessionId).toBeTruthy();

      const res = await apiRequest("POST", `/sessions/${sessionId}/extract`, {
        instruction: "Extract the main heading text from the page",
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      const parsed = Api.ExtractResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.success).toBe(true);
        expect(parsed.data.data.result).toBeDefined();
      }
    });

    test("POST /sessions/:id/observe finds available actions", async () => {
      expect(sessionId).toBeTruthy();

      const res = await apiRequest("POST", `/sessions/${sessionId}/observe`, {
        instruction: "Find the 'More information' link",
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      const parsed = Api.ObserveResponseSchema.safeParse(body);
      if (!parsed.success) {
        console.log("Observe body:", JSON.stringify(body, null, 2));
        console.log("Observe parse errors:", parsed.error.issues);
      }
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.success).toBe(true);
        expect(Array.isArray(parsed.data.data.result)).toBe(true);
      }
    });

    test("POST /sessions/:id/act performs an action", async () => {
      expect(sessionId).toBeTruthy();

      // Use the action from observe result
      const res = await apiRequest("POST", `/sessions/${sessionId}/act`, {
        input: {
          selector: "xpath=/html[1]/body[1]/div[1]/p[2]/a[1]",
          description: "More information link",
          method: "click",
          arguments: [],
        },
      });

      if (res.status !== 200) {
        const body = await res.json();
        console.log("Act status:", res.status);
        console.log("Act body:", JSON.stringify(body, null, 2));
      }
      expect(res.status).toBe(200);

      const body = await res.json();
      const parsed = Api.ActResponseSchema.safeParse(body);
      if (!parsed.success) {
        console.log("Act response body:", JSON.stringify(body, null, 2));
        console.log("Act parse errors:", parsed.error.issues);
      }
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.success).toBe(true);
        expect(parsed.data.data.result.success).toBeDefined();
        expect(parsed.data.data.result.message).toBeDefined();
      }
    });

    test("POST /sessions/:id/end ends the session", async () => {
      expect(sessionId).toBeTruthy();

      const res = await apiRequest("POST", `/sessions/${sessionId}/end`, {});

      if (res.status !== 200) {
        const errBody = await res.json();
        console.log("End status:", res.status);
        console.log("End error:", JSON.stringify(errBody, null, 2));
      }
      expect(res.status).toBe(200);

      const body = await res.json();
      const parsed = Api.SessionEndResponseSchema.safeParse(body);
      if (!parsed.success) {
        console.log("End response body:", JSON.stringify(body, null, 2));
        console.log("End parse errors:", parsed.error.issues);
      }
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.success).toBe(true);
      }

      // Clear sessionId so afterAll doesn't try to clean up again
      sessionId = null;
    });

    test("returns error for non-existent session", async () => {
      const res = await apiRequest(
        "POST",
        "/sessions/non-existent-session-id/observe",
        { instruction: "test" },
      );

      // Prod returns 500, local server returns 404
      expect([404, 500]).toContain(res.status);
    });
  },
);
