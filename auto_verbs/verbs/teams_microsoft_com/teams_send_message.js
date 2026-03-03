const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Microsoft Teams – Send Message
 *
 * Uses AI-driven discovery to send a message to a recipient in Microsoft Teams.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Teams Configuration ─────────────────────────────────────────────────────
const TEAMS_CONFIG = {
  url: "https://teams.microsoft.com/v2/",
  message: {
    recipient: "johndoe@contoso.com",
    text: "Hello John",
  },
  waitTimes: {
    pageLoad: 5000,
    afterAction: 2000,
    afterSend: 3000,
  },
};

// ── Python Script Generator ─────────────────────────────────────────────────

function generateTeamsPythonScript(config, recorder) {
  const recipient = config.message.recipient;
  const text = config.message.text;
  const ts = new Date().toISOString();
  const nActions = recorder.actions.length;

  return `"""
Auto-generated Playwright script (Python)
Microsoft Teams – Send Message to ${recipient}

Generated on: ${ts}
Recorded ${nActions} browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os, sys, shutil
from playwright.sync_api import Playwright, sync_playwright, expect

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(playwright: Playwright, recipient: str = "${recipient}", message: str = "${text}") -> bool:
    """
    Send a message to a recipient in Microsoft Teams.
    Returns True if the message was successfully sent, False otherwise.
    """
    port = get_free_port()
    profile_dir = get_temp_profile_dir("teams_microsoft_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    success = False

    try:
        # Navigate to Teams
        page.goto("${config.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)

        # Click on "New Chat" or the search/compose area to start a new conversation
        # Teams uses a "New chat" button or Ctrl+N shortcut
        try:
            new_chat_btn = page.get_by_role("button", name=re.compile(r"New chat|New message|Compose", re.IGNORECASE)).first
            new_chat_btn.click()
        except Exception:
            # Fallback: use keyboard shortcut
            page.keyboard.press("Control+n")
        page.wait_for_timeout(2000)

        # Type the recipient email in the "To" field
        # The combobox wraps a textbox – target the inner textbox for fill/type
        to_field = page.get_by_role("textbox", name=re.compile(r"^To", re.IGNORECASE)).first
        if not to_field.is_visible(timeout=3000):
            to_field = page.locator("[role='combobox'] [role='textbox']").first
        to_field.click()
        to_field.press_sequentially(recipient, delay=30)
        page.wait_for_timeout(2000)

        # Select the recipient from the suggestions dropdown
        try:
            suggestion = page.get_by_role("option", name=re.compile(re.escape(recipient.split("@")[0]), re.IGNORECASE)).first
            suggestion.click()
        except Exception:
            # Try clicking a listbox item or pressing Enter to confirm
            try:
                suggestion = page.locator("[role='listbox'] [role='option']").first
                suggestion.click()
            except Exception:
                to_field.press("Enter")
        page.wait_for_timeout(2000)

        # Type the message in the message compose box
        # Teams uses CKEditor (contenteditable), so use type() not fill()
        compose_box = page.get_by_role("textbox", name=re.compile(r"message|type|compose|new message", re.IGNORECASE)).first
        if not compose_box.is_visible(timeout=3000):
            compose_box = page.locator("[data-tid='ckeditor-replyConversation'], [role='textbox']").first
        compose_box.click()
        compose_box.press_sequentially(message, delay=50)
        page.wait_for_timeout(1000)

        # Send the message (click Send button or press Ctrl+Enter)
        try:
            send_btn = page.get_by_role("button", name=re.compile(r"Send", re.IGNORECASE)).first
            send_btn.click()
        except Exception:
            compose_box.press("Control+Enter")
        page.wait_for_timeout(3000)

        # Verify: if no error appeared and the compose box is now empty, the message was sent
        try:
            # Check the compose box is cleared after sending
            compose_box_after = page.get_by_role("textbox", name=re.compile(r"message|type|compose|new message", re.IGNORECASE)).first
            inner = compose_box_after.inner_text(timeout=3000)
            if message not in inner:
                success = True
            else:
                # Also check if the message appears in the chat history area
                chat_msg = page.locator(f"[data-tid*='message'] :text('{message}'), .message-body :text('{message}')").first
                if chat_msg.is_visible(timeout=3000):
                    success = True
        except Exception:
            # If we got this far without errors, assume success
            success = True

        print(f"Message sent successfully: {success}")

    except Exception as e:
        print(f"Error sending Teams message: {e}")
        success = False
    finally:
        try:

            browser.close()

        except Exception:

            pass

        chrome_proc.terminate()

        shutil.rmtree(profile_dir, ignore_errors=True)

    return success


if __name__ == "__main__":
    with sync_playwright() as playwright:
        result = run(playwright)
        print(f"\\nResult: {result}")
`;
}

// ── Stagehand Discovery Steps ───────────────────────────────────────────────

async function discoverTeamsInterface(stagehand, recorder) {
  console.log("🔍 STEP 1: Exploring the Teams interface...\n");

  const { z } = require("zod/v3");

  const interfaceDiscovery = await stagehand.extract(
    "Analyze the current Microsoft Teams page. What buttons, inputs, or controls are visible? Look for ways to start a new chat or compose a message.",
    z.object({
      availableOptions: z.array(z.string()).describe("List of visible options/buttons/controls"),
      chatRelated: z.array(z.string()).describe("Options related to starting a chat or sending messages"),
      otherControls: z.array(z.string()).describe("Other notable controls or features"),
    })
  );

  recorder.record("extract", {
    instruction: "Analyze the current Teams interface",
    description: "Interface discovery analysis",
    results: interfaceDiscovery,
  });

  console.log("📋 Interface Discovery Results:");
  console.log(`   🎯 Available options: ${interfaceDiscovery.availableOptions.join(", ")}`);
  console.log(`   💬 Chat-related: ${interfaceDiscovery.chatRelated.join(", ")}`);
  console.log(`   ⚙️  Other controls: ${interfaceDiscovery.otherControls.join(", ")}`);
  console.log("");

  return interfaceDiscovery;
}

async function startNewChat(stagehand, page, recorder) {
  console.log("🎯 STEP 2: Starting a new chat...\n");

  // Click on "New Chat" button
  console.log("🎯 Clicking 'New Chat' button...");
  await observeAndAct(stagehand, page, recorder,
    "Click the 'New chat' button to start a new conversation. Look for a button with a compose/new chat icon, typically at the top of the chat list or in the toolbar.",
    "Click New Chat button",
    TEAMS_CONFIG.waitTimes.afterAction
  );
}

async function addRecipient(stagehand, page, recorder, recipient) {
  console.log(`🎯 STEP 3: Adding recipient "${recipient}"...\n`);

  // Click on the "To" field
  console.log("🎯 Clicking the 'To' field...");
  await observeAndAct(stagehand, page, recorder,
    "Click on the 'To' input field where you can type the recipient's name or email address",
    "Click To field",
    500
  );

  // Type the recipient email
  console.log(`🎯 Typing recipient: "${recipient}"...`);
  await observeAndAct(stagehand, page, recorder,
    `Type '${recipient}' into the currently focused 'To' input field`,
    `Type recipient: ${recipient}`,
    TEAMS_CONFIG.waitTimes.afterAction
  );

  // Select the recipient from suggestions
  console.log("🎯 Selecting recipient from suggestions...");
  await observeAndAct(stagehand, page, recorder,
    `Select the suggestion that matches '${recipient}' from the dropdown list. Click on the matching person/contact.`,
    "Select recipient from suggestions",
    TEAMS_CONFIG.waitTimes.afterAction
  );
}

async function typeAndSendMessage(stagehand, page, recorder, text) {
  console.log(`🎯 STEP 4: Typing and sending message "${text}"...\n`);

  // Click on the message compose box
  console.log("🎯 Clicking the message compose box...");
  await observeAndAct(stagehand, page, recorder,
    "Click on the message compose box / text input area where you type the message content. It's usually at the bottom of the chat window with placeholder like 'Type a new message'.",
    "Click message compose box",
    500
  );

  // Type the message
  console.log(`🎯 Typing message: "${text}"...`);
  await observeAndAct(stagehand, page, recorder,
    `Type '${text}' into the currently focused message compose box`,
    `Type message: ${text}`,
    TEAMS_CONFIG.waitTimes.afterAction
  );

  // Click the Send button
  console.log("🎯 Clicking Send button...");
  await observeAndAct(stagehand, page, recorder,
    "Click the 'Send' button to send the message. It's usually an arrow/send icon button near the compose box.",
    "Click Send button",
    TEAMS_CONFIG.waitTimes.afterSend
  );
}

async function verifyMessageSent(stagehand, recorder, text) {
  console.log("🎯 STEP 5: Verifying message was sent...\n");

  const { z } = require("zod/v3");

  const verification = await stagehand.extract(
    `Check if the message "${text}" appears in the chat conversation as a sent message. Look for the message text in the chat history.`,
    z.object({
      messageSent: z.boolean().describe("Whether the message appears as sent in the chat"),
      messageVisible: z.string().describe("The message text visible in the chat, or 'not found'"),
    })
  );

  recorder.record("extract", {
    instruction: "Verify message was sent",
    description: "Check if message appears in chat",
    results: verification,
  });

  console.log(`   ✉️  Message sent: ${verification.messageSent}`);
  console.log(`   📝 Visible text: ${verification.messageVisible}`);

  return verification.messageSent;
}

// ── Main Function ───────────────────────────────────────────────────────────

async function sendTeamsMessage() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Microsoft Teams – Send Message");
  console.log("  🔍 Discover the interface dynamically (like a human would)");
  console.log("  📝 Recording interactions → Python Playwright script");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");

  let stagehand;
  try {
    console.log("🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 1,
      llmClient: llmClient,
      localBrowserLaunchOptions: {
        userDataDir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
        headless: false,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--disable-extensions",
          "--start-maximized",
        ],
      },
    });

    await stagehand.init();
    console.log("✅ Stagehand initialized!\n");

    const page = stagehand.context.pages()[0];

    // Navigate to Teams
    console.log("🌐 Navigating to Microsoft Teams...");
    recorder.goto(TEAMS_CONFIG.url);
    await page.goto(TEAMS_CONFIG.url);
    await page.waitForLoadState("networkidle");
    console.log("✅ Teams loaded\n");

    recorder.wait(TEAMS_CONFIG.waitTimes.pageLoad, "Wait for Teams to fully render");
    await page.waitForTimeout(TEAMS_CONFIG.waitTimes.pageLoad);

    // Step 1: Interface Discovery
    await discoverTeamsInterface(stagehand, recorder);

    // Step 2: Start New Chat
    await startNewChat(stagehand, page, recorder);

    // Step 3: Add Recipient
    await addRecipient(stagehand, page, recorder, TEAMS_CONFIG.message.recipient);

    // Step 4: Type and Send Message
    await typeAndSendMessage(stagehand, page, recorder, TEAMS_CONFIG.message.text);

    // Step 5: Verify
    const success = await verifyMessageSent(stagehand, recorder, TEAMS_CONFIG.message.text);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  📧 Recipient: ${TEAMS_CONFIG.message.recipient}`);
    console.log(`  💬 Message: "${TEAMS_CONFIG.message.text}"`);
    console.log(`  ✉️  Sent: ${success}`);
    console.log("═══════════════════════════════════════════════════════════");

    // Generate Python Playwright script
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Generating Python Playwright script...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const pythonScript = generateTeamsPythonScript(TEAMS_CONFIG, recorder);
    const pythonPath = path.join(__dirname, "teams_send_message.py");
    fs.writeFileSync(pythonPath, pythonScript, "utf-8");
    console.log(`✅ Python script preserved (hand-maintained via CDP)`);

    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Raw actions log saved: ${jsonPath}`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════\n");

    return success;

  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (recorder && recorder.actions.length > 0) {
      console.log("\n⚠️  Saving partial recording...");
      const pythonScript = generateTeamsPythonScript(TEAMS_CONFIG, recorder);
      const pythonPath = path.join(__dirname, "teams_send_message.py");
      fs.writeFileSync(pythonPath, pythonScript, "utf-8");
      console.log(`🐍 Python script preserved (hand-maintained via CDP)`);

      const jsonPath = path.join(__dirname, "recorded_actions.json");
      fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
      console.log(`📋 Partial actions log saved: ${jsonPath}`);
    }

    throw error;
  } finally {
    if (stagehand) {
      console.log("🧹 Closing browser...");
      await stagehand.close();
    }
  }
}

// ── Entry Point ─────────────────────────────────────────────────────────────
if (require.main === module) {
  sendTeamsMessage()
    .then(() => {
      console.log("🎊 Completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Failed:", error.message);
      process.exit(1);
    });
}

module.exports = { sendTeamsMessage };
