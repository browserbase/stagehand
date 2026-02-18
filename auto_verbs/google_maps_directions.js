const { Stagehand } = require("@browserbasehq/stagehand");
const fs = require("fs");
const path = require("path");

/**
 * Google Maps Driving Directions: Bellevue Square → Redmond Town Center
 * 
 * Uses Stagehand to automate the search, records all browser interactions,
 * and generates a Python Playwright script from the recorded actions.
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

  click(selector, description) {
    this.record("click", { selector, description: description || `Click ${selector}` });
  }

  fill(selector, value, description) {
    this.record("fill", { selector, value, description: description || `Fill ${selector} with "${value}"` });
  }

  press(selector, key, description) {
    this.record("press", { selector, key, description: description || `Press ${key}` });
  }

  wait(ms, description) {
    this.record("wait", { ms, description: description || `Wait ${ms}ms` });
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
      `Auto-generated Playwright script (Python)`,
      `Google Maps Driving Directions: Bellevue Square → Redmond Town Center`,
      ``,
      `Generated on: ${new Date().toISOString()}`,
      `Recorded ${this.actions.length} browser interactions`,
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
      lines.push(`    # ${action.description}`);

      switch (action.type) {
        case "goto":
          lines.push(`    page.goto("${action.url}")`);
          lines.push(`    page.wait_for_load_state("domcontentloaded")`);
          break;

        case "click":
          if (action.selector) {
            lines.push(`    page.locator("${this._escapePy(action.selector)}").click()`);
          } else {
            lines.push(`    # Action performed via AI: ${action.description}`);
          }
          break;

        case "fill":
          if (action.selector) {
            lines.push(`    page.locator("${this._escapePy(action.selector)}").fill("${this._escapePy(action.value)}")`);
          } else {
            lines.push(`    # Action performed via AI: Fill "${action.value}"`);
          }
          break;

        case "press":
          if (action.selector) {
            lines.push(`    page.locator("${this._escapePy(action.selector)}").press("${action.key}")`);
          } else {
            lines.push(`    page.keyboard.press("${action.key}")`);
          }
          break;

        case "wait":
          lines.push(`    page.wait_for_timeout(${action.ms})`);
          break;

        case "screenshot":
          lines.push(`    page.screenshot(path="${action.name}.png")`);
          break;

        case "extract_text":
          if (action.selector) {
            lines.push(`    ${action.variableName} = page.locator("${this._escapePy(action.selector)}").text_content()`);
            lines.push(`    print(f"${action.variableName}: {${action.variableName}}")`);
          } else {
            lines.push(`    # Text extracted via AI: ${action.description}`);
          }
          break;

        case "act":
          lines.push(`    # Stagehand AI action: ${action.instruction}`);
          lines.push(`    # Observed: ${action.observedDescription || action.description}`);
          if (action.aria) {
            // Prefer ARIA-based locators for resilience
            const aria = action.aria;
            const method = action.method || "click";
            const args = action.arguments || [];
            const role = aria.role || aria.implicitRole;
            const label = aria.ariaLabel || aria.placeholder || aria.tooltip || aria.title || null;
            const text = aria.textContent || null;

            // Only scope when the DOM has multiple elements with the same role+label
            const needsScoping = (aria.matchCount || 1) > 1;

            let scopePrefix = "";
            if (needsScoping) {
              const ancestors = aria.ariaAncestors || [];
              const elementLabel = (label || text || "").toLowerCase();

              // Strategy: find the nearest ancestor that can uniquely scope this element.
              // IDs are unique by HTML spec, so they're the most reliable disambiguator.
              // ARIA labels on ancestors may still be shared (e.g., "Google Maps" wraps both
              // Search buttons), so only use them if no ID-based scope is available.

              // 1. Nearest ancestor with an ID (most reliable)
              const idAnc = ancestors.find(a => a.id);
              // 2. Nearest ancestor with a distinguishing aria-label (not same as element's)
              const ariaAnc = ancestors.find(a => a.ariaLabel && a.ariaLabel.toLowerCase() !== elementLabel);
              // 3. Nearest ancestor with role + distinguishing aria-label
              const roleAnc = ancestors.find(a => a.role && a.ariaLabel && a.ariaLabel.toLowerCase() !== elementLabel);

              if (idAnc) {
                // ID is guaranteed unique — best for disambiguation
                scopePrefix = `page.locator("#${this._escapePy(idAnc.id)}").`;
                lines.push(`    # Scoped to #${idAnc.id} (${aria.matchCount} elements share this role+label)`);
              } else if (roleAnc) {
                const kw = this._extractKeyword(roleAnc.ariaLabel);
                scopePrefix = `page.get_by_role("${roleAnc.role}", name=re.compile(r"${this._escapePy(kw)}", re.IGNORECASE)).`;
                lines.push(`    # Scoped via ancestor role="${roleAnc.role}", label="${roleAnc.ariaLabel}"`);
              } else if (ariaAnc) {
                const kw = this._extractKeyword(ariaAnc.ariaLabel);
                scopePrefix = `page.get_by_label(re.compile(r"${this._escapePy(kw)}", re.IGNORECASE)).`;
                lines.push(`    # Scoped via ancestor aria-label="${ariaAnc.ariaLabel}"`);
              } else if (aria.nearestAncestorId) {
                scopePrefix = `page.locator("#${this._escapePy(aria.nearestAncestorId)}").`;
                lines.push(`    # Scoped to parent #${aria.nearestAncestorId}`);
              }
            }

            let locatorCode;
            if (role && label) {
              const labelEsc = this._escapePy(label);
              const keyword = this._extractKeyword(label);
              locatorCode = `${scopePrefix || "page."}get_by_role("${role}", name=re.compile(r"${this._escapePy(keyword)}", re.IGNORECASE))`;
              lines.push(`    # ARIA: role="${role}", label="${labelEsc}"`);
            } else if (label) {
              const keyword = this._extractKeyword(label);
              locatorCode = `${scopePrefix || "page."}get_by_label(re.compile(r"${this._escapePy(keyword)}", re.IGNORECASE))`;
              lines.push(`    # ARIA: label="${this._escapePy(label)}"`);
            } else if (role && text) {
              const keyword = this._extractKeyword(text);
              locatorCode = `${scopePrefix || "page."}get_by_role("${role}", name=re.compile(r"${this._escapePy(keyword)}", re.IGNORECASE))`;
              lines.push(`    # ARIA: role="${role}", text="${this._escapePy(text)}"`);
            } else if (action.selector) {
              locatorCode = `page.locator("${this._escapePy(action.selector)}")`;
              lines.push(`    # Fallback to XPath (no ARIA attributes found)`);
            }

            if (locatorCode) {
              if (method === "fill" || method === "type") {
                const value = args.length > 0 ? this._escapePy(args[0]) : "";
                lines.push(`    ${locatorCode}.fill("${value}")`);
              } else if (method === "press") {
                const key = args.length > 0 ? args[0] : "Enter";
                lines.push(`    ${locatorCode}.press("${key}")`);
              } else {
                lines.push(`    ${locatorCode}.click()`);
              }
            }
          } else if (action.selector) {
            const sel = this._escapePy(action.selector);
            const method = action.method || "click";
            const args = action.arguments || [];
            lines.push(`    # Fallback to XPath (no ARIA info captured)`);
            if (method === "fill" || method === "type") {
              const value = args.length > 0 ? this._escapePy(args[0]) : "";
              lines.push(`    page.locator("${sel}").fill("${value}")`);
            } else if (method === "press") {
              const key = args.length > 0 ? args[0] : "Enter";
              lines.push(`    page.locator("${sel}").press("${key}")`);
            } else {
              lines.push(`    page.locator("${sel}").click()`);
            }
          } else {
            lines.push(`    # No selector recorded for this action`);
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

  /** Extract essential keyword(s) from a label for resilient regex matching */
  _extractKeyword(label) {
    if (!label) return "";
    // Remove filler phrases like "Choose ... or click on the map..."
    // Keep the core identifying words
    let cleaned = label
      .replace(/,?\s*or click on the map\.{0,3}/i, "")
      .replace(/^choose\s+/i, "")
      .trim();
    // If still long, take first few meaningful words (up to ~40 chars)
    if (cleaned.length > 40) {
      cleaned = cleaned.substring(0, 40).replace(/\s+\S*$/, "");
    }
    return cleaned;
  }
}


// ── Main Program ────────────────────────────────────────────────────────────
async function searchGoogleMapsDirections() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Google Maps Directions: Bellevue Square → Redmond Town Center");
  console.log("  Recording browser interactions → Python Playwright script");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recorder = new PlaywrightRecorder();

  // ── Step 0: Verify OAuth proxy ──────────────────────────────────────────
  try {
    const response = await fetch("http://localhost:3001/health");
    const health = await response.json();
    console.log("✅ Proxy health check:", health.status);
  } catch (error) {
    console.error("❌ OAuth proxy not running! Start it first:");
    console.error("   cd my-stagehand-app && node oauth-proxy-server.js");
    process.exit(1);
  }

  let stagehand;
  try {
    // ── Step 1: Initialize Stagehand ────────────────────────────────────
    console.log("\n🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 1,
      model: {
        modelName: "openai/gpt-4o",
        apiKey: "oauth-dummy",
        baseURL: "http://localhost:3001/v1",
      },
    });

    await stagehand.init();
    console.log("✅ Stagehand initialized!\n");

    const page = stagehand.context.pages()[0];

    // ── Step 2: Navigate to Google Maps ─────────────────────────────────
    console.log("🌐 Navigating to Google Maps...");
    const mapsUrl = "https://www.google.com/maps";
    recorder.goto(mapsUrl);
    await page.goto(mapsUrl);
    await page.waitForLoadState("networkidle");
    console.log("✅ Google Maps loaded\n");

    // Small pause to let the page fully render
    recorder.wait(2000, "Wait for Google Maps to fully render");
    await page.waitForTimeout(2000);

    // ── Helper: observe then act, recording actual selectors + ARIA info ─
    async function observeAndAct(instruction, description, waitAfterMs = 1000) {
      console.log(`  🔍 Observing: ${instruction}`);
      const actions = await stagehand.observe(instruction);
      const action = actions[0];
      if (action) {
        console.log(`  🎯 Found: ${action.description} [${action.method || "click"}] → ${action.selector}`);

        // Extract ARIA attributes from the actual DOM element BEFORE acting.
        // We use page.evaluate() with document.evaluate() to resolve the XPath
        // directly in the browser, because Stagehand wraps the Playwright page
        // and its locator API doesn't support waitFor/evaluate reliably.
        let ariaInfo = null;
        try {
          const xpathStr = action.selector.replace(/^xpath=/, "");
          ariaInfo = await page.evaluate((xpath) => {
            const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (!node) return null;
            const tagName = node.tagName.toLowerCase();
            const type = node.getAttribute("type") || null;
            const role = node.getAttribute("role") || null;
            const implicitRoles = {
              button: "button", a: "link",
              input: type === "submit" ? "button" : "textbox",
              textarea: "textbox", select: "combobox", img: "img",
              nav: "navigation", header: "banner", footer: "contentinfo",
              main: "main", form: "form", table: "table",
              h1: "heading", h2: "heading", h3: "heading",
              h4: "heading", h5: "heading", h6: "heading",
            };
            const ariaLabel = node.getAttribute("aria-label") || null;
            const placeholder = node.getAttribute("placeholder") || null;
            const tooltip = node.getAttribute("data-tooltip") || node.getAttribute("tooltip") || null;
            const title = node.getAttribute("title") || null;
            const textContent = (node.textContent || "").trim().substring(0, 100);
            const bestLabel = ariaLabel || placeholder || tooltip || title || textContent || null;

            // Count how many elements on the page share the same role+label (for disambiguation)
            const effectiveRole = role || implicitRoles[tagName] || null;
            let matchCount = 1;
            if (effectiveRole && bestLabel) {
              // Use querySelectorAll with matching aria-label or equivalent
              const allMatches = document.querySelectorAll(
                `[aria-label="${bestLabel.replace(/"/g, '\\"')}"]`
              );
              // Filter to same tag/role
              matchCount = Array.from(allMatches).filter(el => {
                const elRole = el.getAttribute("role") || implicitRoles[el.tagName.toLowerCase()] || null;
                return elRole === effectiveRole;
              }).length;
            }

            // Walk up ancestors collecting ARIA-labeled nodes for scoping/disambiguation.
            // Prefer ancestors with aria-label/role over bare IDs.
            const ariaAncestors = [];
            let nearestAncestorId = null;
            let parent = node.parentElement;
            while (parent && parent !== document.body && parent !== document.documentElement) {
              const pAriaLabel = parent.getAttribute("aria-label") || null;
              const pRole = parent.getAttribute("role") || null;
              const pId = parent.id || null;
              const pPlaceholder = parent.getAttribute("placeholder") || null;
              const pTitle = parent.getAttribute("title") || null;
              const pTooltip = parent.getAttribute("data-tooltip") || null;
              // Record this ancestor if it has any useful attribute
              if (pAriaLabel || pRole || pId) {
                ariaAncestors.push({
                  tagName: parent.tagName.toLowerCase(),
                  ariaLabel: pAriaLabel,
                  role: pRole,
                  id: pId,
                  placeholder: pPlaceholder,
                  title: pTitle,
                  tooltip: pTooltip,
                });
              }
              if (!nearestAncestorId && pId) {
                nearestAncestorId = pId;
              }
              parent = parent.parentElement;
            }
            return {
              tagName, type, role,
              implicitRole: implicitRoles[tagName] || null,
              ariaLabel, placeholder, title, tooltip, textContent,
              name: node.getAttribute("name") || null,
              id: node.getAttribute("id") || null,
              className: node.getAttribute("class") || null,
              bestLabel,
              matchCount,
              nearestAncestorId,
              ariaAncestors,
            };
          }, xpathStr);
          if (ariaInfo) {
            const ancestorSummary = (ariaInfo.ariaAncestors || []).slice(0, 3).map(a => {
              if (a.ariaLabel) return `[aria-label="${a.ariaLabel}"]`;
              if (a.role) return `[role="${a.role}"]`;
              if (a.id) return `#${a.id}`;
              return a.tagName;
            }).join(" > ") || "none";
            console.log(`  📋 ARIA: tag=${ariaInfo.tagName}, role=${ariaInfo.implicitRole || ariaInfo.role}, label="${ariaInfo.bestLabel}", matches=${ariaInfo.matchCount}, ancestors: ${ancestorSummary}`);
          }
        } catch (e) {
          console.log(`  ⚠️  Could not extract ARIA info: ${e.message}`);
        }

        recorder.record("act", {
          instruction,
          description: description || action.description,
          selector: action.selector,
          method: action.method || "click",
          arguments: action.arguments || [],
          observedDescription: action.description,
          aria: ariaInfo,
        });

        // Now perform the actual action
        await stagehand.act(action);
      } else {
        console.log(`  ⚠️  No element found, falling back to direct act`);
        recorder.record("act", {
          instruction,
          description,
          selector: null,
          method: null,
          arguments: [],
          aria: null,
        });
        await stagehand.act(instruction);
      }
      if (waitAfterMs > 0) {
        recorder.wait(waitAfterMs, `Wait after: ${description}`);
        await page.waitForTimeout(waitAfterMs);
      }
    }

    // ── Step 3: Click Directions button ─────────────────────────────────
    console.log("🧭 Opening directions panel...");
    await observeAndAct(
      "click the Directions button",
      "Click the Directions button on Google Maps",
      1500
    );
    console.log("✅ Directions panel opened\n");

    // ── Step 4: Enter starting point ────────────────────────────────────
    console.log("📍 Entering starting point: Bellevue Square...");
    await observeAndAct(
      "click on the starting point input field",
      "Click the starting point input field",
      500
    );
    await observeAndAct(
      "type 'Bellevue Square, Bellevue, WA' into the starting point input field",
      "Type starting location: Bellevue Square, Bellevue, WA",
      1000
    );
    console.log("✅ Starting point entered\n");

    // ── Step 5: Enter destination ───────────────────────────────────────
    console.log("📍 Entering destination: Redmond Town Center...");
    await observeAndAct(
      "click on the destination input field",
      "Click the destination input field",
      500
    );
    await observeAndAct(
      "type 'Redmond Town Center, Redmond, WA' into the destination input field",
      "Type destination: Redmond Town Center, Redmond, WA",
      1000
    );
    console.log("✅ Destination entered\n");

    // ── Step 6: Submit and search for directions ────────────────────────
    console.log("🔍 Searching for directions...");
    await observeAndAct(
      "press Enter to search for directions",
      "Press Enter to search for directions",
      5000
    );
    console.log("✅ Directions search submitted\n");

    // ── Step 7: Ensure driving mode is selected ─────────────────────────
    console.log("🚗 Selecting driving mode...");
    await observeAndAct(
      "click the driving mode button to select driving directions (the car icon)",
      "Select driving mode",
      3000
    );
    console.log("✅ Driving mode selected\n");

    // ── Step 8: Take screenshot of results ──────────────────────────────
    console.log("📸 Taking screenshot of directions...");
    const screenshotPath = path.join(__dirname, "directions_result.png");
    recorder.screenshot("directions_result");
    await page.screenshot({ path: screenshotPath });
    console.log(`✅ Screenshot saved: ${screenshotPath}\n`);

    // ── Step 9: Extract directions info ─────────────────────────────────
    console.log("📊 Extracting directions information...");
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

    // ── Step 10: Get the page URL with directions ───────────────────────
    const finalUrl = page.url();
    console.log(`\n🔗 Google Maps URL: ${finalUrl}`);

    // ── Step 11: Generate Python Playwright script ──────────────────────
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

    // ── Summary ─────────────────────────────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  📍 From: Bellevue Square, Bellevue, WA`);
    console.log(`  📍 To:   Redmond Town Center, Redmond, WA`);
    console.log(`  🚗 Distance: ${directionsData.distance}`);
    console.log(`  ⏱️  Duration: ${directionsData.duration}`);
    console.log(`  🛣️  Route: ${directionsData.route}`);
    console.log(`  📸 Screenshot: directions_result.png`);
    console.log(`  🐍 Python script: google_maps_directions.py`);
    console.log(`  📋 Actions log: recorded_actions.json`);
    console.log("═══════════════════════════════════════════════════════════\n");

    return directionsData;
  } catch (error) {
    console.error("\n❌ Error:", error.message);

    // Still generate whatever we have so far
    if (recorder.actions.length > 0) {
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
      console.log("🎊 Program finished successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Program failed:", error.message);
      process.exit(1);
    });
}

module.exports = { searchGoogleMapsDirections, PlaywrightRecorder };
