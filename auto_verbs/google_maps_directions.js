const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct, extractAriaScopeForXPath } = require("./stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Google Maps Directions
 * 
 * Uses AI-driven discovery to dynamically interact with the interface.
 * Refactored to use utility functions for better code organization.
 * Includes Python Playwright script generation.
 */

// ── Google Maps Configuration ───────────────────────────────────────────────
const GOOGLE_MAPS_CONFIG = {
  url: "https://www.google.com/maps",
  locations: {
    start: "Bellevue Square, Bellevue, WA",
    destination: "Redmond Town Center, Redmond, WA"
  },
  waitTimes: {
    pageLoad: 3000,
    afterAction: 1000,
    afterSearch: 5000
  }
};

// ── Google Maps Specific Functions ──────────────────────────────────────────

/**
 * Perform interface discovery specific to Google Maps
 * @param {object} stagehand - Stagehand instance
 * @param {PlaywrightRecorder} recorder - Recorder instance
 * @returns {object} Discovery results
 */
async function discoverGoogleMapsInterface(stagehand, recorder) {
  console.log("🔍 STEP 1: Exploring the Google Maps interface...");
  console.log("   (This is what a human would do - look around first)\n");
  
  const { z } = require("zod/v3");
  
  const interfaceDiscovery = await stagehand.extract(
    "Analyze the current Google Maps interface. What navigation options, buttons, menus, or controls are visible? Look for anything related to directions, routes, or travel planning.",
    z.object({
      availableOptions: z.array(z.string()).describe("List of visible options/buttons/controls"),
      directionsRelated: z.array(z.string()).describe("Options specifically related to getting directions"),
      searchFeatures: z.array(z.string()).describe("Search-related features"),
      otherControls: z.array(z.string()).describe("Other notable controls or features"),
    })
  );

  // Record the interface discovery
  recorder.record("extract", {
    instruction: "Analyze the current Google Maps interface",
    description: "Interface discovery analysis",
    results: interfaceDiscovery,
  });

  console.log("📋 Interface Discovery Results:");
  console.log(`   🎯 Available options: ${interfaceDiscovery.availableOptions.join(", ")}`);
  console.log(`   🧭 Directions-related: ${interfaceDiscovery.directionsRelated.join(", ")}`);
  console.log(`   🔍 Search features: ${interfaceDiscovery.searchFeatures.join(", ")}`);
  console.log(`   ⚙️  Other controls: ${interfaceDiscovery.otherControls.join(", ")}`);
  console.log("");

  return interfaceDiscovery;
}

/**
 * Plan strategy for getting directions based on discovered interface
 * @param {object} stagehand - Stagehand instance
 * @param {PlaywrightRecorder} recorder - Recorder instance
 * @param {object} interfaceDiscovery - Previously discovered interface elements
 * @returns {object} Strategy plan
 */
async function planDirectionsStrategy(stagehand, recorder, interfaceDiscovery) {
  console.log("🔍 STEP 2: Planning our approach based on discovery...");
  console.log("   (Now we adapt our strategy based on what we found)\n");

  const { z } = require("zod/v3");

  // Based on what we discovered, let's plan our approach
  const strategyPlan = await stagehand.extract(
    `Based on the available options found: ${interfaceDiscovery.availableOptions.join(", ")}, what's the best approach to get driving directions from "${GOOGLE_MAPS_CONFIG.locations.start}" to "${GOOGLE_MAPS_CONFIG.locations.destination}"? Consider the available directions-related features: ${interfaceDiscovery.directionsRelated.join(", ")}`,
    z.object({
      recommendedApproach: z.string().describe("The best strategy to get directions"),
      firstAction: z.string().describe("What should we click or interact with first"),
      expectedWorkflow: z.array(z.string()).describe("Step-by-step workflow we expect to follow"),
      alternativesIfFailed: z.array(z.string()).describe("Backup approaches if the main one doesn't work"),
    })
  );

  // Record the strategy planning
  recorder.record("extract", {
    instruction: "Plan strategy for getting directions",
    description: "Dynamic strategy planning based on interface discovery",
    results: strategyPlan,
  });

  console.log("🎯 Dynamic Strategy Plan:");
  console.log(`   📋 Recommended approach: ${strategyPlan.recommendedApproach}`);
  console.log(`   🎯 First action: ${strategyPlan.firstAction}`);
  console.log("   📝 Expected workflow:");
  strategyPlan.expectedWorkflow.forEach((step, i) => {
    console.log(`      ${i + 1}. ${step}`);
  });
  console.log("   🔄 Backup plans:");
  strategyPlan.alternativesIfFailed.forEach((alt, i) => {
    console.log(`      • ${alt}`);
  });
  console.log("");

  return strategyPlan;
}

/**
 * Execute the Google Maps directions workflow
 * @param {object} stagehand - Stagehand instance
 * @param {object} page - Playwright page instance
 * @param {PlaywrightRecorder} recorder - Recorder instance
 * @param {object} strategyPlan - Previously created strategy plan
 */
async function executeDirectionsWorkflow(stagehand, page, recorder, strategyPlan) {
  console.log("🎯 STEP 3: Executing the discovered strategy...");
  console.log("   (Now we act based on our dynamic discovery)\n");

  // Execute the first action from our plan
  console.log(`🎯 Executing first action: ${strategyPlan.firstAction}`);
  await observeAndAct(stagehand, page, recorder, strategyPlan.firstAction, "Execute first planned action", 2000);

  // Check what happened after our first action
  const { z } = require("zod/v3");
  const afterFirstAction = await stagehand.extract(
    "What changed after our action? What new options or input fields are now available?",
    z.object({
      newInterface: z.string().describe("Description of the current state"),
      availableInputs: z.array(z.string()).describe("Input fields or controls now visible"),
      nextApproach: z.string().describe("What should we do next based on current state"),
    })
  );

  // Record the state check
  recorder.record("extract", {
    instruction: "Check interface state after first action",
    description: "Verify that UI changed as expected after first action",
    results: afterFirstAction,
  });

  console.log("🔄 Interface After First Action:");  
  console.log(`   📱 Current state: ${afterFirstAction.newInterface}`);
  console.log(`   📝 Available inputs: ${afterFirstAction.availableInputs.join(", ")}`);
  console.log(`   ➡️  Next step: ${afterFirstAction.nextApproach}`);
  console.log("");

  // Continue with the specific Google Maps workflow
  await executeGoogleMapsDirectionsSteps(stagehand, page, recorder);
}

/**
 * Execute the specific steps for Google Maps directions
 * @param {object} stagehand - Stagehand instance
 * @param {object} page - Playwright page instance
 * @param {PlaywrightRecorder} recorder - Recorder instance
 */
async function executeGoogleMapsDirectionsSteps(stagehand, page, recorder) {
  // Continue with dynamic adaptation using improved approach...
  console.log("🎯 Clicking starting location field...");
  await observeAndAct(stagehand, page, recorder, "click on the starting point input field", "Click starting location field first", 500);

  console.log("🎯 Entering starting location...");
  await observeAndAct(stagehand, page, recorder, `Enter '${GOOGLE_MAPS_CONFIG.locations.start}' in the starting location field`, `Enter starting location: ${GOOGLE_MAPS_CONFIG.locations.start}`, GOOGLE_MAPS_CONFIG.waitTimes.afterAction);

  console.log("🎯 Clicking destination field...");
  await observeAndAct(stagehand, page, recorder, "click on the destination input field", "Click destination field first", 500);

  console.log("🎯 Entering destination...");
  await observeAndAct(stagehand, page, recorder, `Enter '${GOOGLE_MAPS_CONFIG.locations.destination}' in the destination field`, `Enter destination: ${GOOGLE_MAPS_CONFIG.locations.destination}`, GOOGLE_MAPS_CONFIG.waitTimes.afterAction);

  console.log("🎯 Searching for directions...");
  await observeAndAct(stagehand, page, recorder, "Press Enter to search for directions", "Search for directions using Enter key", GOOGLE_MAPS_CONFIG.waitTimes.afterSearch);
}

/**
 * Verify and extract the final route results
 * @param {object} stagehand - Stagehand instance
 * @param {object} page - Playwright page instance
 * @param {PlaywrightRecorder} recorder - Recorder instance
 * @returns {object} Final route results
 */
async function verifyAndExtractResults(stagehand, page, recorder) {
  const { z } = require("zod/v3");

  // Verify we got results
  const routeCheck = await stagehand.extract(
    "Are driving directions now displayed? What route information is visible?",
    z.object({
      directionsVisible: z.boolean().describe("Whether directions are shown"),
      routeInfo: z.string().describe("Description of visible route information"),
      needsAction: z.string().optional().describe("Any additional action needed"),
    })
  );

  // Record the route verification
  recorder.record("extract", {
    instruction: "Verify that directions are displayed",
    description: "Check if route search was successful",
    results: routeCheck,
  });

  console.log("🔍 Route Check:");
  console.log(`   ✅ Directions visible: ${routeCheck.directionsVisible}`);
  console.log(`   📍 Route info: ${routeCheck.routeInfo}`);
  if (routeCheck.needsAction) {
    console.log(`   ⚠️  Action needed: ${routeCheck.needsAction}`);
    await observeAndAct(stagehand, page, recorder, routeCheck.needsAction, "Additional action needed for route display", 3000);
  }

  // Extract final results
  console.log("\n📊 Extracting final directions...");
  const finalResults = await stagehand.extract(
    "Extract the complete driving directions information including distance, time, and route details",
    z.object({
      distance: z.string().describe("Total driving distance"),
      duration: z.string().describe("Estimated travel time"),
      route: z.string().describe("Route name or highway information"),
      via: z.string().optional().describe("Via description if available"),
      success: z.boolean().describe("Whether we successfully got directions"),
    })
  );

  // Record the final extraction
  recorder.record("extract", {
    instruction: "Extract complete driving directions information",
    description: "Final extraction of route details",
    results: finalResults,
  });

  return finalResults;
}

// ── Main Google Maps Function ───────────────────────────────────────────────

// Removing the old PlaywrightRecorder class since it's now in utilities...
async function searchGoogleMapsDirections() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Google Maps Directions");
  console.log("  🔍 Discover the interface dynamically (like a human would)");
  console.log("  📝 Recording interactions → Python Playwright script");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient(); // Uses Copilot CLI by default (no rate limits)

  let stagehand;
  try {
    // ── Initialize Stagehand ────────────────────────────────────────────
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

    // ── Navigate to Google Maps ─────────────────────────────────────────
    console.log("🌐 Navigating to Google Maps...");
    recorder.goto(GOOGLE_MAPS_CONFIG.url);
    await page.goto(GOOGLE_MAPS_CONFIG.url);
    await page.waitForLoadState("networkidle");
    console.log("✅ Google Maps loaded\n");

    // Wait for page to fully render
    recorder.wait(GOOGLE_MAPS_CONFIG.waitTimes.pageLoad, "Wait for Google Maps to fully render");
    await page.waitForTimeout(GOOGLE_MAPS_CONFIG.waitTimes.pageLoad);

    // ══════════════════════════════════════════════════════════════════════
    // 🔍 Discover what's available first!
    // ══════════════════════════════════════════════════════════════════════
    
    // Step 1: Interface Discovery
    const interfaceDiscovery = await discoverGoogleMapsInterface(stagehand, recorder);
    
    // Step 2: Strategy Planning
    const strategyPlan = await planDirectionsStrategy(stagehand, recorder, interfaceDiscovery);
    
    // Step 3: Execute Workflow
    await executeDirectionsWorkflow(stagehand, page, recorder, strategyPlan);
    
    // Step 4: Verify and Extract Results
    const finalResults = await verifyAndExtractResults(stagehand, page, recorder);

    // Locate and extract travel time and distance elements
    console.log("📍 Locating travel time and distance elements...");
    
    // Use observe to find the travel time element
    console.log("🕒 Finding travel time element...");
    const travelTimeActions = await stagehand.observe("locate the travel time or duration element that shows how long the trip will take");
    // Extract ARIA scope info for the observed element's xpath
    let travelTimeAriaScope = null;
    if (travelTimeActions[0]?.selector) {
      travelTimeAriaScope = await extractAriaScopeForXPath(page, travelTimeActions[0].selector);
      if (travelTimeAriaScope?.ancestor) {
        const anc = travelTimeAriaScope.ancestor;
        console.log(`  📋 ARIA Scope: ancestor=${anc.id ? '#' + anc.id : (anc.ariaLabel || anc.role)}, stepsUp=${anc.stepsFromTarget}, textMatches=${travelTimeAriaScope.textMatchCount}, regexMatches=${travelTimeAriaScope.regexMatchCount}, xpathTail=${travelTimeAriaScope.xpathTail}`);
      } else {
        console.log(`  ⚠️  No aria-locatable ancestor found for travel time element`);
      }
    }
    recorder.record("observe", {
      instruction: "locate the travel time or duration element that shows how long the trip will take",
      description: "Find the element displaying travel time/duration",
      actions: travelTimeActions,
      ariaScope: travelTimeAriaScope,
    });

    // Use observe to find the distance element  
    console.log("📏 Finding distance element...");
    const distanceActions = await stagehand.observe("locate the distance element that shows the total driving distance");
    // Extract ARIA scope info for the observed element's xpath
    let distanceAriaScope = null;
    if (distanceActions[0]?.selector) {
      distanceAriaScope = await extractAriaScopeForXPath(page, distanceActions[0].selector);
      if (distanceAriaScope?.ancestor) {
        const anc = distanceAriaScope.ancestor;
        console.log(`  📋 ARIA Scope: ancestor=${anc.id ? '#' + anc.id : (anc.ariaLabel || anc.role)}, stepsUp=${anc.stepsFromTarget}, textMatches=${distanceAriaScope.textMatchCount}, regexMatches=${distanceAriaScope.regexMatchCount}, xpathTail=${distanceAriaScope.xpathTail}`);
      } else {
        console.log(`  ⚠️  No aria-locatable ancestor found for distance element`);
      }
    }
    recorder.record("observe", {
      instruction: "locate the distance element that shows the total driving distance", 
      description: "Find the element displaying total distance",
      actions: distanceActions,
      ariaScope: distanceAriaScope,
    });

    // Extract the actual values from these elements
    console.log("📊 Extracting travel time and distance values...");
    const { z } = require("zod/v3");
    
    const elementData = await stagehand.extract(
      "Extract the travel time and distance values from their respective elements on the page",
      z.object({
        travelTime: z.string().describe("The travel time/duration value"),
        distance: z.string().describe("The distance value"),
        travelTimeElementInfo: z.string().describe("Description of where the travel time element is located"),
        distanceElementInfo: z.string().describe("Description of where the distance element is located"),
      })
    );

    // Record the element data extraction
    recorder.record("extract", {
      instruction: "Extract travel time and distance values from their elements",
      description: "Get the actual values and element location info for travel time and distance",
      results: elementData,
    });

    console.log("✅ Element data extracted:");
    console.log(`   🕒 Travel Time: ${elementData.travelTime} (located at: ${elementData.travelTimeElementInfo})`);
    console.log(`   📏 Distance: ${elementData.distance} (located at: ${elementData.distanceElementInfo})`);
    
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  🎯 Success: ${finalResults.success}`);
    console.log(`  🚗 Distance: ${finalResults.distance}`);
    console.log(`  ⏱️  Duration: ${finalResults.duration}`);
    console.log(`  🛣️  Route: ${finalResults.route}`);
    if (finalResults.via) {
      console.log(`  📍 Via: ${finalResults.via}`);
    }
    console.log("  📊 Element Data Extracted:");
    console.log(`     🕒 Travel Time Element: ${elementData.travelTime}`);
    console.log(`     📏 Distance Element: ${elementData.distance}`);
    console.log("═══════════════════════════════════════════════════════════");

    // ── Generate Python Playwright script ──────────────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Generating Python Playwright script...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const pythonScript = recorder.generatePythonScript();
    const pythonPath = path.join(__dirname, "google_maps_directions.py");
    fs.writeFileSync(pythonPath, pythonScript, "utf-8");
    console.log(`✅ Python Playwright script saved: ${pythonPath}`);

    // Also save the recorded actions as JSON for debugging
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Raw actions log saved: ${jsonPath}`);

    console.log("");
    console.log("🧠 KEY DIFFERENCE FROM PREDETERMINED APPROACH:");
    console.log("   • We DISCOVERED the interface first (like a human)");
    console.log("   • We ADAPTED our strategy based on what we found");
    console.log("   • We VERIFIED each step before proceeding");
    console.log("   • We can handle UI changes more gracefully");
    console.log("   • We RECORDED everything → Python Playwright script");
    console.log("═══════════════════════════════════════════════════════════\n");

    return finalResults;

  } catch (error) {
    console.error("\n❌ Error:", error.message);

    // Still generate whatever we have so far
    if (recorder && recorder.actions.length > 0) {
      console.log("\n⚠️  Saving partial recording...");
      const pythonScript = recorder.generatePythonScript();
      const pythonPath = path.join(__dirname, "google_maps_directions.py");
      fs.writeFileSync(pythonPath, pythonScript, "utf-8");
      console.log(`🐍 Partial Python script saved: ${pythonPath}`);

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
  searchGoogleMapsDirections()
    .then(() => {
      console.log("🎊 Completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Failed:", error.message);
      process.exit(1);
    });
}

module.exports = { 
  searchGoogleMapsDirections,
  discoverGoogleMapsInterface,
  planDirectionsStrategy,
  executeDirectionsWorkflow,
  executeGoogleMapsDirectionsSteps,
  verifyAndExtractResults
};