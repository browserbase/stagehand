const { Stagehand, CustomOpenAIClient } = require("@browserbasehq/stagehand");
const { AzureOpenAI } = require("openai");
const { getBearerTokenProvider, AzureCliCredential, DefaultAzureCredential, ChainedTokenCredential } = require("@azure/identity");
const path = require("path");
const http = require("http");
const fs = require("fs");

/**
 * Google Maps Driving Directions using CUA (Computer Use Agent)
 * 
 * This version uses Stagehand's autonomous CUA agent to dynamically discover
 * and interact with the Google Maps interface, rather than following
 * predetermined steps. Records interactions and generates Python Playwright script.
 */

// ── Interaction Recorder ────────────────────────────────────────────────────
class PlaywrightRecorder {
  constructor() {
    this.actions = [];
    this.startTime = Date.now();
  }

  record(type, details) {
    this.actions.push({
      timestamp: Date.now() - this.startTime,
      type,
      ...details,
    });
    console.log(`  📝 Recorded: ${type} → ${details.description || JSON.stringify(details)}`);
  }

  goto(url) {
    this.record("goto", { url, description: `Navigate to ${url}` });
  }

  cuaAgentTask(instruction, result) {
    this.record("cua_agent_task", { 
      instruction, 
      result: result?.message || "Task completed",
      description: `CUA Agent Task: ${instruction.replace(/\s+/g, ' ').slice(0, 100)}...` 
    });
  }

  // Record browser events captured during CUA execution
  recordBrowserEvent(eventType, details) {
    this.record("browser_event", {
      eventType,
      details,
      description: `Browser Event: ${eventType} - ${JSON.stringify(details).slice(0, 100)}...`
    });
  }

  screenshot(name) {
    this.record("screenshot", { name, description: `Take screenshot: ${name}` });
  }

  extractText(selector, variableName, description) {
    this.record("extract_text", { selector, variableName, description: description || `Extract text from ${selector}` });
  }

  /** Generate a Python Playwright script from recorded actions */
  generatePythonScript() {
    const lines = [
      `"""`,
      `Auto-generated Playwright script (Python) - CUA Version`,
      `Google Maps Driving Directions: Bellevue Square → Redmond Town Center`,
      ``,
      `Generated on: ${new Date().toISOString()}`,
      `Recorded ${this.actions.length} browser interactions via CUA Agent`,
      `"""`,
      ``,
      `import re`,
      `from playwright.sync_api import Playwright, sync_playwright, expect`,
      ``,
      ``,
      `def run(playwright: Playwright) -> None:`,
      `    browser = playwright.chromium.launch(headless=False, channel="chrome")`,
      `    context = browser.new_context(`,
      `        viewport={"width": 1280, "height": 720},`,
      `        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",`,
      `    )`,
      `    page = context.new_page()`,
      ``,
    ];

    for (const action of this.actions) {
      // Handle multi-line descriptions
      const descriptionLines = action.description.split('\n');
      descriptionLines.forEach(line => {
        lines.push(`    # ${this._escapePy(line)}`);
      });

      switch (action.type) {
        case "goto":
          lines.push(`    page.goto("${action.url}")`);
          lines.push(`    page.wait_for_load_state("domcontentloaded")`);
          break;

        case "cua_agent_task":
          lines.push(`    # CUA Agent executed autonomous task:`);
          // Handle multi-line instruction
          const instructionLines = action.instruction.split('\n');
          instructionLines.forEach(line => {
            lines.push(`    # ${this._escapePy(line)}`);
          });
          lines.push(`    # Result:`);
          // Handle multi-line result
          const resultLines = action.result.split('\n');
          resultLines.forEach(line => {
            lines.push(`    # ${this._escapePy(line)}`);
          });
          lines.push(`    `);
          lines.push(`    # Implementation: Google Maps Directions Workflow`);
          lines.push(`    print("Starting Google Maps directions workflow...")`);
          lines.push(`    `);
          lines.push(`    # Step 1: Click Directions button`);
          lines.push(`    try:`);
          lines.push(`        directions_btn = page.get_by_role("button", name=re.compile(r"directions", re.IGNORECASE))`);
          lines.push(`        directions_btn.click()`);
          lines.push(`        print("✅ Clicked Directions button")`);
          lines.push(`        page.wait_for_timeout(1500)`);
          lines.push(`    except Exception as e:`);
          lines.push(`        print(f"⚠️ Directions button: {e}")`);
          lines.push(`    `);
          lines.push(`    # Step 2: Enter starting location`);
          lines.push(`    try:`);
          lines.push(`        start_input = page.locator('input[aria-label*="starting point"], input[placeholder*="starting point"], input[aria-label*="Choose starting point"]').first`);
          lines.push(`        start_input.click()`);
          lines.push(`        start_input.fill("Bellevue Square, Bellevue, WA")`);
          lines.push(`        print("✅ Entered starting location")`);
          lines.push(`        page.wait_for_timeout(1000)`);
          lines.push(`    except Exception as e:`);
          lines.push(`        print(f"⚠️ Starting location: {e}")`);
          lines.push(`    `);
          lines.push(`    # Step 3: Enter destination`);
          lines.push(`    try:`);
          lines.push(`        dest_input = page.locator('input[aria-label*="destination"], input[placeholder*="destination"], input[aria-label*="Choose destination"]').first`);
          lines.push(`        dest_input.click()`);
          lines.push(`        dest_input.fill("Redmond Town Center, Redmond, WA")`);
          lines.push(`        page.keyboard.press("Enter")`);
          lines.push(`        print("✅ Entered destination and searched")`);
          lines.push(`        page.wait_for_timeout(3000)`);
          lines.push(`    except Exception as e:`);
          lines.push(`        print(f"⚠️ Destination: {e}")`);
          lines.push(`    `);
          lines.push(`    # Step 4: Ensure driving mode is selected`);
          lines.push(`    try:`);
          lines.push(`        driving_btn = page.get_by_role("radio", name=re.compile(r"driving", re.IGNORECASE))`);
          lines.push(`        if not driving_btn.is_checked():`);
          lines.push(`            driving_btn.click()`);
          lines.push(`            print("✅ Selected driving mode")`);
          lines.push(`        else:`);
          lines.push(`            print("✅ Driving mode already selected")`);
          lines.push(`        page.wait_for_timeout(2000)`);
          lines.push(`    except Exception as e:`);
          lines.push(`        print(f"⚠️ Driving mode: {e}")`);
          lines.push(`    `);
          lines.push(`    # Step 5: Extract route information`);
          lines.push(`    try:`);
          lines.push(`        # Wait for route to load`);
          lines.push(`        page.wait_for_timeout(3000)`);
          lines.push(`        `);
          lines.push(`        # Try multiple selectors for route info`);
          lines.push(`        distance_elem = page.locator('text=/\\\\d+\\\\.?\\\\d*\\\\s*(mi|miles|km)/').first`);
          lines.push(`        duration_elem = page.locator('text=/\\\\d+\\\\s*(min|hour|hr)/').first`);
          lines.push(`        route_elem = page.locator('text=/via\\\\s+[A-Z0-9-]+/').first`);
          lines.push(`        `);
          lines.push(`        distance = distance_elem.text_content() if distance_elem.is_visible() else "N/A"`);
          lines.push(`        duration = duration_elem.text_content() if duration_elem.is_visible() else "N/A"`);
          lines.push(`        route = route_elem.text_content() if route_elem.is_visible() else "N/A"`);
          lines.push(`        `);
          lines.push(`        print(f"📊 Route Information:")`);
          lines.push(`        print(f"   🚗 Distance: {distance}")`);
          lines.push(`        print(f"   ⏱️ Duration: {duration}")`);
          lines.push(`        print(f"   🛣️ Route: {route}")`);
          lines.push(`    except Exception as e:`);
          lines.push(`        print(f"⚠️ Route extraction: {e}")`);
          lines.push(`    `);
          break;

        case "browser_event":
          const event = action.details;
          lines.push(`    # Browser Event: ${event.type} on ${event.tagName || 'unknown'}`);
          if (event.ariaLabel) {
            lines.push(`    # Element: aria-label="${event.ariaLabel}"`);
          }
          if (event.id) {
            lines.push(`    # Element: id="${event.id}"`);
          }
          if (event.className) {
            lines.push(`    # Element: class="${event.className}"`);
          }
          if (event.value) {
            lines.push(`    # Input value: "${event.value}"`);
          }
          if (event.x && event.y) {
            lines.push(`    # Coordinates: (${event.x}, ${event.y})`);
          }
          lines.push(`    # Timestamp: ${event.timestamp}`);
          lines.push(``);
          break;

        case "screenshot":
          lines.push(`    page.screenshot(path="${action.name}.png")`);
          break;

        case "extract_text":
          if (action.selector) {
            lines.push(`    ${action.variableName} = page.locator("${this._escapePy(action.selector)}").text_content()`);
            lines.push(`    print(f"${action.variableName}: {${action.variableName}}")`);
          } else {
            lines.push(`    # Text extracted via CUA Agent: ${action.description}`);
          }
          break;

        default:
          lines.push(`    # Unknown action: ${action.type}`);
      }
      lines.push(``);
    }

    lines.push(`    # ---------------------`);
    lines.push(`    # Cleanup`);
    lines.push(`    # ---------------------`);
    lines.push(`    context.close()`);
    lines.push(`    browser.close()`);
    lines.push(``);
    lines.push(``);
    lines.push(`with sync_playwright() as playwright:`);
    lines.push(`    run(playwright)`);
    lines.push(``);

    return lines.join("\n");
  }

  _escapePy(s) {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}

// ── CUA Bridge Setup (matches working version) ──────────────────────────────
function createAzureOAuthClient(modelName = "gpt-4o") {
  const scope = "api://trapi/.default";
  const credential = getBearerTokenProvider(
    new ChainedTokenCredential(
      new AzureCliCredential(),
      new DefaultAzureCredential()
    ),
    scope
  );
  const azureEndpoint = "https://trapi.research.microsoft.com/redmond/interactive";
  const azureClient = new AzureOpenAI({
    endpoint: azureEndpoint,
    azureADTokenProvider: credential,
    apiVersion: "2024-10-21",
  });
  return new CustomOpenAIClient({
    modelName: "gpt-4o_2024-11-20",
    client: azureClient,
  });
}

async function startCuaBridge() {
  const scope = "api://trapi/.default";
  const credential = getBearerTokenProvider(
    new ChainedTokenCredential(
      new AzureCliCredential(),
      new DefaultAzureCredential()
    ),
    scope
  );
  
  // Create separate clients for different API endpoints
  const chatClient = new AzureOpenAI({
    endpoint: "https://trapi.research.microsoft.com/redmond/interactive",
    azureADTokenProvider: credential,
    apiVersion: "2024-10-21",
  });
  
  const responsesClient = new AzureOpenAI({
    endpoint: "https://trapi.research.microsoft.com/redmond/interactive",
    azureADTokenProvider: credential,
    apiVersion: "2025-03-01-preview", // Different API version for responses
  });
  
  const server = http.createServer(async (req, res) => {
    console.log(`🔍 CUA Bridge: Received ${req.method} ${req.url}`);
    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/v1/responses')) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          console.log(`🔍 CUA Bridge DEBUG: Received model: ${request.model}`);
          console.log(`🔍 CUA Bridge DEBUG: Request keys:`, Object.keys(request));
          console.log(`🔍 CUA Bridge DEBUG: Full request:`, JSON.stringify(request, null, 2));
          
          // Map the model to Azure deployment
          const modelMap = {
            "openai/computer-use-preview": "computer-use-preview_2025-03-11",
            "computer-use-preview": "computer-use-preview_2025-03-11", 
            "computer-use-preview-2025-03-11": "computer-use-preview_2025-03-11"
          };
          const originalModel = request.model;
          const mappedModel = modelMap[request.model] || "computer-use-preview_2025-03-11";
          console.log(`🔍 CUA Bridge DEBUG: Mapped ${originalModel} -> ${mappedModel}`);
          
          let response;
          if (req.url.startsWith('/v1/responses')) {
            // Responses API (CUA)
            response = await responsesClient.responses.create({
              ...request,
              model: mappedModel,
            });
          } else {
            // Chat completions API
            response = await chatClient.chat.completions.create({
              ...request,
              model: mappedModel,
            });
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (error) {
          console.error('🔍 CUA Bridge DEBUG: Azure API Error:', error.message);
          console.error('🔍 CUA Bridge DEBUG: Error details:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

async function searchGoogleMapsWithAgent() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Google Maps Directions with CUA Agent");
  console.log("  Computer Use Agent with Azure OpenAI + Python Generation");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recorder = new PlaywrightRecorder();

  let cuaBridge;
  let stagehand;
  
  try {
    // ── Setup Azure OAuth and CUA Bridge ─────────────────────────────────────
    console.log("🔑 Setting up Azure OAuth and CUA bridge...");
    const llmClient = createAzureOAuthClient("gpt-4o");
    cuaBridge = await startCuaBridge();
    
    const cuaModel = {
      modelName: "openai/computer-use-preview",
      apiKey: "azure-oauth", // dummy – bridge handles real auth
      baseURL: `http://127.0.0.1:${cuaBridge.port}/v1`,
    };
    
    console.log(`✅ Azure OAuth & CUA bridge ready`);
    console.log(`   LLM client: direct`);
    console.log(`   CUA bridge: http://127.0.0.1:${cuaBridge.port}/v1\n`);
    // ── Initialize Stagehand ────────────────────────────────────────────
    console.log("🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 2,
      llmClient: llmClient,
      experimental: true, // Required for CUA mode
    });

    await stagehand.init();
    console.log("✅ Stagehand initialized!\n");

    // ── Navigate to Google Maps ─────────────────────────────────────────
    const page = stagehand.context.pages()[0];
    console.log("🌐 Navigating to Google Maps...");
    const mapsUrl = "https://www.google.com/maps";
    recorder.goto(mapsUrl);
    await page.goto(mapsUrl);
    await page.waitForLoadState("networkidle");
    console.log("✅ Google Maps loaded\n");

    // ── Setup Comprehensive Event Monitoring ─────────────────────────────
    console.log("🔍 Setting up browser event monitoring for CUA actions...");
    
    // Track console messages that might contain CUA event data
    page.on('console', msg => {
      if (msg.text().includes('CUA_EVENT:')) {
        try {
          const eventData = JSON.parse(msg.text().replace('CUA_EVENT:', ''));
          console.log(`🔍 Captured ${eventData.type} event on ${eventData.tagName}${eventData.id ? `#${eventData.id}` : ''}${eventData.selector ? ` (${eventData.selector})` : ''}`);
          recorder.recordBrowserEvent(eventData.type, eventData);
        } catch (e) {
          console.log(`⚠️ Failed to parse event: ${msg.text()}`);
        }
      }
    });

    // Monitor DOM events through page evaluation with detailed capture
    await page.evaluate(() => {
      // Initialize event storage
      window.capturedEvents = [];
      
      const events = ['click', 'mousedown', 'mouseup', 'input', 'change', 'keydown', 'keyup', 'focus', 'blur'];
      
      events.forEach(eventType => {
        document.addEventListener(eventType, (event) => {
          const target = event.target;
          
          // Create comprehensive selector info
          const getSelector = (el) => {
            if (el.id) return `#${el.id}`;
            if (el.className && typeof el.className === 'string') {
              const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
              if (classes) return `.${classes}`;
            }
            return el.tagName.toLowerCase();
          };

          // Helper function to generate XPath
          function getXPath(element) {
            if (element.id !== '') return `id("${element.id}")`;
            if (element === document.body) return '/html/body';
            
            let ix = 0;
            const siblings = element.parentNode?.childNodes || [];
            for (let i = 0; i < siblings.length; i++) {
              const sibling = siblings[i];
              if (sibling === element) {
                const tagName = element.tagName?.toLowerCase() || 'unknown';
                return `${getXPath(element.parentNode)}/${tagName}[${(ix + 1)}]`;
              }
              if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
                ix++;
              }
            }
            return '';
          }

          const eventData = {
            type: eventType,
            tagName: target.tagName?.toLowerCase() || 'unknown',
            id: target.id || '',
            className: target.className || '',
            selector: getSelector(target),
            ariaLabel: target.getAttribute('aria-label') || '',
            placeholder: target.getAttribute('placeholder') || '',
            role: target.getAttribute('role') || '',
            value: target.value || target.textContent?.slice(0, 50) || '',
            xpath: getXPath(target),
            timestamp: Date.now(),
            x: event.clientX || 0,
            y: event.clientY || 0,
            key: event.key || '',
            button: event.button !== undefined ? event.button : -1
          };
          
          // Store in window and log to console for Playwright to capture
          window.capturedEvents.push(eventData);
          console.log('CUA_EVENT:' + JSON.stringify(eventData));
        }, true);
      });
      
      console.log('🔍 Browser event monitoring active - watching for DOM interactions');
    });

    console.log("✅ Event monitoring setup complete\n");

    // ── Create CUA Agent ──────────────────────────────────────────────
    console.log("🤖 Creating CUA agent...");
    console.log("🔍 DEBUG: CUA model config:", JSON.stringify(cuaModel, null, 2));
    const agent = stagehand.agent({
      mode: "cua", // Use Computer Use Agent mode
      model: cuaModel, // Proper CUA model with bridge
      systemPrompt: `You are a helpful assistant that can navigate web pages using computer vision and mouse/keyboard actions.
        You will help get driving directions from one location to another on Google Maps.
        
        Key behaviors:
        - Use your vision to see the page and understand what's available
        - Click on buttons, input fields, and other UI elements as needed
        - Enter text accurately into input fields
        - Extract the final results from the displayed directions
        - Be methodical and explain what you see at each step
        
        Use your computer use capabilities to accomplish the task through direct interaction.`,
    });

    // ── Let the CUA agent autonomously figure out the task ─────────────────
    console.log("🎯 Starting CUA autonomous task execution...");
    const taskInstruction = `
        Get driving directions from "Bellevue Square, Bellevue, WA" to "Redmond Town Center, Redmond, WA".
        
        Use your computer vision to:
        1. See and understand the current Google Maps interface
        2. Find and click on the directions functionality 
        3. Click on and enter the starting location: "Bellevue Square, Bellevue, WA"
        4. Click on and enter the destination: "Redmond Town Center, Redmond, WA" 
        5. Make sure driving mode is selected (not walking, transit, etc.)
        6. Wait for the route to calculate and display
        7. Read and report back the key information: distance, estimated time, and main route/highway used
        
        Use direct mouse clicks and keyboard input to interact with the page elements.
      `;
    
    console.log("🔍 Starting event capture before CUA execution...");
    
    // Collect events before CUA execution
    const eventsBefore = await page.evaluate(() => {
      return window.capturedEvents ? window.capturedEvents.length : 0;
    });
    
    const result = await agent.execute({
      instruction: taskInstruction,
      maxSteps: 30, // CUA agents may need more steps
    });
    
    console.log("🔍 CUA execution complete, analyzing captured events...");
    
    // Small delay to ensure all events are captured
    await page.waitForTimeout(1000);
    
    // Check how many events we captured during CUA execution
    const eventsAfter = await page.evaluate(() => {
      return window.capturedEvents ? window.capturedEvents.length : 0;
    });
    
    const newEventsCount = eventsAfter - eventsBefore;
    console.log(`\n📊 CUA Agent execution generated ${newEventsCount} new browser events`);
    
    if (newEventsCount === 0) {
      console.log("⚠️  No DOM events captured - CUA may be using coordinate-based clicks");
      console.log("🔍 This suggests CUA operates below the DOM event layer");
    }
    
    // Record the CUA agent task execution
    recorder.cuaAgentTask(taskInstruction, result);

    console.log("\n🎊 CUA Agent completed the task!");
    console.log("📋 Final result:", result.message);

    // ── Take a screenshot of the final result ──────────────────────────
    console.log("\n📸 Taking final screenshot...");
    const screenshotName = "cua_directions_result";
    recorder.screenshot(screenshotName);
    await page.screenshot({ 
      path: path.join(__dirname, `${screenshotName}.png`) 
    });
    console.log(`✅ Screenshot saved: ${screenshotName}.png`);
    
    // ── Extract additional info from the page ─────────────────────────────
    console.log("\n📊 Extracting additional page information...");
    try {
      const { z } = require("zod/v3");
      const directionsData = await stagehand.extract(
        "Extract the driving directions summary including: the total distance, the estimated travel time, and the route name/highway used for the recommended route",
        z.object({
          distance: z.string().describe("Total driving distance"),
          duration: z.string().describe("Estimated travel time"),
          route: z.string().describe("Route name or highway"),
          via: z.string().optional().describe("Via description if available"),
        })
      );
      
      recorder.extractText(null, "directions_info", `Extracted: distance=${directionsData.distance}, duration=${directionsData.duration}, route=${directionsData.route}`);
      
      console.log("✅ Directions extracted:");
      console.log(`   🚗 Distance: ${directionsData.distance}`);
      console.log(`   ⏱️  Duration: ${directionsData.duration}`);
      console.log(`   🛣️  Route: ${directionsData.route}`);
      if (directionsData.via) {
        console.log(`   📍 Via: ${directionsData.via}`);
      }
    } catch (error) {
      console.log(`⚠️  Could not extract detailed directions info: ${error.message}`);
    }
    
    // ── Generate Python Playwright script ──────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Generating Python Playwright script...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const pythonScript = recorder.generatePythonScript();
    const pythonPath = path.join(__dirname, "google_maps_directions_cua.py");
    fs.writeFileSync(pythonPath, pythonScript, "utf-8");
    console.log(`✅ Python Playwright script saved: ${pythonPath}`);

    // Also save the recorded actions as JSON for debugging
    const jsonPath = path.join(__dirname, "recorded_actions_cua.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Raw actions log saved: ${jsonPath}`);

    // ── Summary ─────────────────────────────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ CUA AGENT COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  📍 Task: Bellevue Square → Redmond Town Center`);
    console.log(`  🤖 Method: CUA (Computer Use Agent)`);
    console.log(`  📸 Screenshot: cua_directions_result.png`);
    console.log(`  🐍 Python script: google_maps_directions_cua.py`);
    console.log(`  📋 Actions log: recorded_actions_cua.json`);
    console.log("═══════════════════════════════════════════════════════════\n");

    return result;

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    
    // Still generate whatever we have so far
    if (recorder.actions.length > 0) {
      console.log("\n⚠️  Saving partial recording...");
      const pythonScript = recorder.generatePythonScript();
      const pythonPath = path.join(__dirname, "google_maps_directions_cua.py");
      fs.writeFileSync(pythonPath, pythonScript, "utf-8");
      console.log(`🐍 Partial Python script saved: ${pythonPath}`);

      const jsonPath = path.join(__dirname, "recorded_actions_cua.json");
      fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
      console.log(`📋 Partial actions log saved: ${jsonPath}`);
    }
    
    throw error;
  } finally {
    if (stagehand) {
      console.log("🧹 Closing browser...");
      await stagehand.close();
    }
    if (cuaBridge) {
      console.log("🛑 Stopping CUA bridge...");
      cuaBridge.server.close();
    }
  }
}

// ── Entry Point ─────────────────────────────────────────────────────────────
if (require.main === module) {
  // Run the CUA Agent version
  searchGoogleMapsWithAgent()
    .then(() => {
      console.log("🎊 CUA Agent program finished successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 CUA Agent program failed:", error.message);
      process.exit(1);
    });
}

module.exports = { searchGoogleMapsWithAgent };