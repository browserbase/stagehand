#!/usr/bin/env node
/**
 * Centralized Browserbase session creator with stealth/proxy/captcha enabled
 *
 * Usage:
 *   node browserbase-session-creator.mjs
 *
 * Environment variables:
 *   BROWSERBASE_API_KEY      - Required
 *   BROWSERBASE_PROJECT_ID   - Required
 *
 * Output (JSON to stdout):
 *   {
 *     "sessionId": "bb_...",
 *     "connectUrl": "wss://connect.browserbase.com/...",
 *     "debugUrl": "https://www.browserbase.com/sessions/..."
 *   }
 *
 * This session is configured with:
 * - proxies: true (managed proxies)
 * - browserSettings.solveCaptchas: true
 * - browserSettings.advancedStealth: true
 * - browserSettings.blockAds: true
 */

const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;

if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
  console.error(JSON.stringify({
    error: 'BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required',
  }));
  process.exit(1);
}

async function createSession() {
  try {
    const response = await fetch('https://api.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BB-API-Key': BROWSERBASE_API_KEY,
      },
      body: JSON.stringify({
        projectId: BROWSERBASE_PROJECT_ID,
        proxies: true, // Enable managed proxies
        browserSettings: {
          advancedStealth: true,
          solveCaptchas: true,
          blockAds: true,
          viewport: {
            width: 1288,
            height: 711,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Browserbase API error (${response.status}): ${errorText}`);
    }

    const session = await response.json();

    if (!session.id || !session.connectUrl) {
      throw new Error('Invalid session response: missing id or connectUrl');
    }

    // Output session details as JSON
    const output = {
      sessionId: session.id,
      connectUrl: session.connectUrl,
      debugUrl: `https://www.browserbase.com/sessions/${session.id}`,
    };

    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      stack: error.stack,
    }));
    process.exit(1);
  }
}

createSession();
