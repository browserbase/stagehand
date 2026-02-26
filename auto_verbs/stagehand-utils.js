const { AzureOpenAI } = require("openai");
const { getBearerTokenProvider, AzureCliCredential, DefaultAzureCredential, ChainedTokenCredential } = require("@azure/identity");
const { CustomOpenAIClient } = require("@browserbasehq/stagehand");
const { spawn } = require("child_process");

/**
 * Stagehand Utilities
 * 
 * Reusable components for Stagehand browser automation:
 * - PlaywrightRecorder: Records interactions and generates Python scripts
 * - Azure OAuth setup
 * - Generic observe-and-act helper
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
      `Note: This script was generated using AI-driven discovery patterns`,
      `"""`,
      ``,
      `import re`,
      `import os`,
      `from playwright.sync_api import Playwright, sync_playwright, expect`,
      ``,
      ``,
      `def run(playwright: Playwright) -> None:`,
      `    user_data_dir = os.path.join(`,
      `        os.environ["USERPROFILE"],`,
      `        "AppData", "Local", "Google", "Chrome", "User Data", "Default",`,
      `    )`,
      ``,
      `    context = playwright.chromium.launch_persistent_context(`,
      `        user_data_dir,`,
      `        channel="chrome",`,
      `        headless=False,`,
      `        viewport=None,`,
      `        args=[`,
      `            "--disable-blink-features=AutomationControlled",`,
      `            "--disable-infobars",`,
      `            "--disable-extensions",`,
      `            "--start-maximized",`,
      `        ],`,
      `    )`,
      `    page = context.pages[0] if context.pages else context.new_page()`,
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
          
          // Special handling for search actions - use press Enter instead of click
          const isSearchAction = action.instruction.toLowerCase().includes('search') || 
                                action.description.toLowerCase().includes('search');
          
          if (action.aria) {
            // Prefer ARIA-based locators for resilience
            const aria = action.aria;
            const method = isSearchAction ? "press" : (action.method || "click");
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
              // For search actions, prefer directions-searchbox-1 over searchbox-0
              const idAnc = ancestors.find(a => a.id);
              const ariaAnc = ancestors.find(a => a.ariaLabel && a.ariaLabel.toLowerCase() !== elementLabel);
              const roleAnc = ancestors.find(a => a.role && a.ariaLabel && a.ariaLabel.toLowerCase() !== elementLabel);

              if (idAnc) {
                // Special handling for search boxes - prefer searchbox-1
                let scopeId = idAnc.id;
                if (isSearchAction && scopeId.includes('directions-searchbox-0')) {
                  scopeId = scopeId.replace('directions-searchbox-0', 'directions-searchbox-1');
                  lines.push(`    # Using corrected searchbox ID for reliability`);
                }
                scopePrefix = `page.locator("#${this._escapePy(scopeId)}").`;
                lines.push(`    # Scoped to #${scopeId} (${aria.matchCount} elements share this role+label)`);
              } else if (roleAnc) {
                const kw = this._extractKeyword(roleAnc.ariaLabel);
                scopePrefix = `page.get_by_role("${roleAnc.role}", name=re.compile(r"${this._escapePy(kw)}", re.IGNORECASE)).`;
                lines.push(`    # Scoped via ancestor role="${roleAnc.role}", label="${roleAnc.ariaLabel}"`);
              } else if (ariaAnc) {
                const kw = this._extractKeyword(ariaAnc.ariaLabel);
                scopePrefix = `page.get_by_label(re.compile(r"${this._escapePy(kw)}", re.IGNORECASE)).`;
                lines.push(`    # Scoped via ancestor aria-label="${ariaAnc.ariaLabel}"`);
              } else if (aria.nearestAncestorId) {
                let scopeId = aria.nearestAncestorId;
                if (isSearchAction && scopeId.includes('directions-searchbox-0')) {
                  scopeId = scopeId.replace('directions-searchbox-0', 'directions-searchbox-1');
                }
                scopePrefix = `page.locator("#${this._escapePy(scopeId)}").`;
                lines.push(`    # Scoped to parent #${scopeId}`);
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
                const key = isSearchAction ? "Enter" : (args.length > 0 ? args[0] : "Enter");
                lines.push(`    ${locatorCode}.press("${key}")`);
              } else {
                lines.push(`    ${locatorCode}.click()`);
              }
            }
          } else if (action.selector) {
            let sel = this._escapePy(action.selector);
            // Fix searchbox IDs in selector
            if (isSearchAction && sel.includes('directions-searchbox-0')) {
              sel = sel.replace('directions-searchbox-0', 'directions-searchbox-1');
              lines.push(`    # Using corrected searchbox ID`);
            }
            const method = isSearchAction ? "press" : (action.method || "click");
            const args = action.arguments || [];
            lines.push(`    # Fallback to XPath (no ARIA info captured)`);
            if (method === "fill" || method === "type") {
              const value = args.length > 0 ? this._escapePy(args[0]) : "";
              lines.push(`    page.locator("${sel}").fill("${value}")`);
            } else if (method === "press") {
              const key = isSearchAction ? "Enter" : (args.length > 0 ? args[0] : "Enter");
              lines.push(`    page.locator("${sel}").press("${key}")`);
            } else {
              lines.push(`    page.locator("${sel}").click()`);
            }
          } else {
            lines.push(`    # No selector recorded for this action`);
          }
          break;

        case "extract":
          lines.push(`    # AI extraction: ${action.instruction}`);
          if (action.results) {
            lines.push(`    # Results: ${JSON.stringify(action.results)}`);
          }
          break;

        case "observe":
          lines.push(`    # Observe action: ${action.instruction}`);
          if (action.description) {
            lines.push(`    # Description: ${action.description}`);
          }
          if (action.actions && action.actions.length > 0) {
            // Generate locator code for the observed elements
            const observedAction = action.actions[0];
            if (observedAction.selector) {
              const varName = action.instruction.toLowerCase().includes('time') ? 'travel_time' : 'distance';
              lines.push(`    # Locating element: ${observedAction.description}`);

              if (action.ariaScope && action.ariaScope.ancestor) {
                // ── Aria-Scoped Locator Algorithm ──────────────────────────
                // (1) Locate the nearest aria-locatable ancestor along the xpath
                // (2) Use it as scope + regex to find the target element
                // (3) If not unique, fall back to xpath-tail within scope
                const scope = action.ariaScope;
                const anc = scope.ancestor;

                // Step 1: Build a Playwright locator for the aria-locatable ancestor
                let scopeLocator;
                if (anc.id) {
                  scopeLocator = `page.locator("#${this._escapePy(anc.id)}")`;
                  lines.push(`    # Scoped to ancestor #${anc.id} (${anc.stepsFromTarget} levels up from target)`);
                } else if (anc.role && anc.ariaLabel) {
                  const keyword = this._extractKeyword(anc.ariaLabel);
                  scopeLocator = `page.get_by_role("${anc.role}", name=re.compile(r"${this._escapePy(keyword)}", re.IGNORECASE))`;
                  lines.push(`    # Scoped to ancestor [role="${anc.role}"][aria-label="${anc.ariaLabel}"]`);
                } else if (anc.ariaLabel) {
                  const keyword = this._extractKeyword(anc.ariaLabel);
                  scopeLocator = `page.get_by_label(re.compile(r"${this._escapePy(keyword)}", re.IGNORECASE))`;
                  lines.push(`    # Scoped to ancestor [aria-label="${anc.ariaLabel}"]`);
                }

                if (scopeLocator) {
                  const isDynamicText = scope.targetText && /\d/.test(scope.targetText);

                  if (scope.targetText && scope.textMatchCount === 1 && !isDynamicText) {
                    // Step 2a: Static text, unique within scope → exact regex match
                    const escapedText = this._escapeRegex(scope.targetText);
                    lines.push(`    # Target text "${scope.targetText}" is unique within scope (1 match)`);
                    lines.push(`    ${varName}_element = ${scopeLocator}.get_by_text(re.compile(r"^${escapedText}$"))`);
                  } else if (isDynamicText) {
                    // Step 2b: Dynamic text → use structural regex that matches the format, not the value
                    const structuralPattern = this._dynamicTextToRegex(scope.targetText);
                    if (structuralPattern && scope.regexMatchCount === 1) {
                      // Structural regex is unique within scope → use it
                      lines.push(`    # Dynamic text "${scope.targetText}" → structural regex (unique: ${scope.regexMatchCount} match in scope)`);
                      lines.push(`    ${varName}_element = ${scopeLocator}.get_by_text(re.compile(r"^${structuralPattern}$"))`);
                    } else if (structuralPattern && scope.regexMatchCount > 1 && scope.regexMatchCount <= 5) {
                      // Multiple regex matches → use .first to get the first one, with comment
                      // Better than xpath-tail because it's still pattern-based
                      lines.push(`    # Dynamic text "${scope.targetText}" → structural regex (${scope.regexMatchCount} matches in scope, using .first)`);
                      lines.push(`    ${varName}_element = ${scopeLocator}.get_by_text(re.compile(r"^${structuralPattern}$")).first`);
                    } else if (scope.xpathTail) {
                      // Too many regex matches or no pattern → xpath-tail fallback
                      lines.push(`    # Dynamic text with ${scope.regexMatchCount || '?'} regex matches, falling back to xpath-tail`);
                      lines.push(`    ${varName}_element = ${scopeLocator}.locator("xpath=./${this._escapePy(scope.xpathTail)}")`);
                    } else {
                      lines.push(`    # Fallback to full XPath (could not compute xpath-tail)`);
                      lines.push(`    ${varName}_element = page.locator("${this._escapePy(observedAction.selector)}")`);
                    }
                  } else if (scope.xpathTail) {
                    // Step 3: Non-dynamic text, not unique → xpath-tail
                    lines.push(`    # Target text not unique within scope (${scope.textMatchCount} matches), using xpath-tail`);
                    lines.push(`    ${varName}_element = ${scopeLocator}.locator("xpath=./${this._escapePy(scope.xpathTail)}")`);
                  } else {
                    lines.push(`    # Fallback to full XPath (could not compute xpath-tail)`);
                    lines.push(`    ${varName}_element = page.locator("${this._escapePy(observedAction.selector)}")`);
                  }
                } else {
                  lines.push(`    # No aria-based scope available, using full XPath`);
                  lines.push(`    ${varName}_element = page.locator("${this._escapePy(observedAction.selector)}")`);
                }
              } else {
                lines.push(`    # Fallback to full XPath (no ARIA scope found)`);
                lines.push(`    ${varName}_element = page.locator("${this._escapePy(observedAction.selector)}")`);
              }

              lines.push(`    ${varName}_text = ${varName}_element.text_content()`);
              const displayName = varName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              lines.push(`    print(f"${displayName}: {${varName}_text}")`);
            } else {
              lines.push(`    # No selector available for observed element`);
            }
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

  /** Escape a string for use in a Python regex pattern */
  _escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Convert dynamic text (e.g. "7.9 miles", "18 min") into a structural
   * regex pattern that matches the format without hardcoding the value.
   *
   * Examples:
   *   "7.9 miles"   → "\\d+\\.?\\d*\\s*miles"
   *   "18 min"      → "\\d+\\s*min"
   *   "2h 36m"      → "\\d+h\\s*\\d+m"
   *   "3:04 PM"     → "\\d+:\\d+\\s*[AP]M"
   *   "$1,234.56"   → "\\$[\\d,]+\\.?\\d*"
   *
   * Returns null if the text has no digits (not dynamic).
   */
  _dynamicTextToRegex(text) {
    if (!text || !/\d/.test(text)) return null;

    // Replace numeric patterns with regex equivalents, preserve word structure
    let pattern = text
      // Time ranges: "3:04 PM—3:58 PM" → digit patterns
      .replace(/\d{1,2}:\d{2}/g, '\\d{1,2}:\\d{2}')
      // Decimal numbers: "7.9" → \d+\.?\d*
      .replace(/\d+\.\d+/g, '\\d+\\.\\d+')
      // Comma-separated numbers: "1,234" → [\d,]+
      .replace(/\d{1,3}(,\d{3})+/g, '[\\d,]+')
      // Plain integers (that weren't already replaced)
      .replace(/(?<!\\d[{+])\d+(?![}\\]\d])/g, '\\d+')
      // Collapse multiple spaces into \s+
      .replace(/\s+/g, '\\s*');

    // Escape any remaining regex-special chars in the non-digit parts,
    // but don't double-escape our own patterns.
    // We split on our inserted patterns, escape the literals, then rejoin.
    const safePatterns = ['\\d+\\.\\d+', '\\d+\\.?\\d*', '\\d{1,2}:\\d{2}', '[\\d,]+', '\\d+', '\\s*', '\\s+'];
    // Since our replacements already produced valid regex fragments, just return.
    return pattern;
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

// ── Azure OAuth Setup ────────────────────────────────────────────────────────
/**
 * Setup Azure OpenAI client with OAuth authentication
 * @returns {CustomOpenAIClient} Configured client for Stagehand
 */
function setupAzureOpenAI() {
  console.log("🔑 Setting up Azure OAuth...");
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
  const llmClient = new CustomOpenAIClient({
    modelName: "gpt-4o_2024-11-20",
    client: azureClient,
  });
  console.log("✅ Azure OAuth ready\n");
  return llmClient;
}

// ── GitHub Models API Setup ──────────────────────────────────────────────────
/**
 * LLM client that uses the GitHub Models API (models.inference.ai.azure.com)
 * authenticated via `gh auth token`. This bypasses the Copilot CLI's ~10-15K
 * prompt size limit by calling the HTTP API directly with standard
 * OpenAI-format chat completions.
 *
 * Endpoint: https://models.inference.ai.azure.com/chat/completions
 * Auth:     Bearer <gh auth token>
 */
class CopilotCliClient {
  constructor(modelName = "gpt-4.1") {
    this.modelName = modelName;
    this._ghToken = null;     // cached GitHub auth token
    this._tokenExpiry = 0;    // refresh token periodically

    // Initialize chat object directly in constructor to ensure it exists
    this.chat = {
      completions: {
        create: async (params) => {
          const response = await this.callModelsApi(params.messages);

          return {
            id: response.id || `ghmodels-${Date.now()}`,
            object: 'chat.completion',
            created: response.created || Math.floor(Date.now() / 1000),
            model: response.model || this.modelName,
            choices: response.choices || [{
              index: 0,
              message: { role: 'assistant', content: response },
              finish_reason: 'stop'
            }],
            usage: response.usage || {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0
            }
          };
        }
      }
    };
  }

  /**
   * Get (or refresh) the GitHub auth token via `gh auth token`.
   * Caches for 30 minutes to avoid repeated process spawns.
   */
  async _getGhToken() {
    const now = Date.now();
    if (this._ghToken && now < this._tokenExpiry) {
      return this._ghToken;
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('gh', ['auth', 'token'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`gh auth token failed (code ${code}): ${stderr}`));
        } else {
          this._ghToken = stdout.trim();
          this._tokenExpiry = now + 30 * 60 * 1000; // 30 min cache
          resolve(this._ghToken);
        }
      });
      proc.on('error', (err) => reject(err));
    });
  }

  /**
   * Strip markdown code fences and extract JSON from the response.
   * The API usually returns clean JSON, but just in case.
   */
  cleanResponse(raw) {
    let cleaned = raw.trim();

    // Remove markdown code fences: ```json ... ``` or ``` ... ```
    const codeBlockMatch = cleaned.match(/```(?:json|\w*)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    // If not valid JSON, try to extract JSON object/array from the tail
    if (cleaned && !this._isJsonLike(cleaned)) {
      const jsonObjMatch = cleaned.match(/(\{[\s\S]*\})\s*$/);
      const jsonArrMatch = cleaned.match(/(\[[\s\S]*\])\s*$/);

      if (jsonObjMatch && this._isJsonLike(jsonObjMatch[1])) {
        cleaned = jsonObjMatch[1].trim();
      } else if (jsonArrMatch && this._isJsonLike(jsonArrMatch[1])) {
        cleaned = jsonArrMatch[1].trim();
      }
    }

    return cleaned;
  }

  _isJsonLike(str) {
    const trimmed = str.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
    try { JSON.parse(trimmed); return true; } catch { return false; }
  }

  // ── Token limit constants ──────────────────────────────────────────────────
  // GitHub Models API enforces a hard 16K token input limit for gpt-4.1/gpt-4o.
  // We target ~12K tokens for content to leave room for system prompt + response.
  // Rough heuristic: 1 token ≈ 4 chars.
  static MAX_INPUT_TOKENS = 12000;
  static CHARS_PER_TOKEN = 4;
  static MAX_INPUT_CHARS = CopilotCliClient.MAX_INPUT_TOKENS * CopilotCliClient.CHARS_PER_TOKEN; // ~48K

  /**
   * Truncate messages to fit within the GitHub Models API input token limit.
   *
   * Strategy (applied to each message that has content):
   *  1. If total chars is under MAX_INPUT_CHARS → return as-is.
   *  2. Identify the largest message (usually the one with the ARIA tree).
   *  3. Apply smart ARIA tree truncation:
   *     a. Remove decorative lines (box-drawing chars like ΓöüΓöü, ΓöÇΓöÇ)
   *     b. Remove consecutive LineBreak nodes
   *     c. Truncate long StaticText content to 80 chars
   *     d. Remove duplicate/redundant StaticText nodes
   *     e. If still too large, keep only actionable elements (button, textbox,
   *        link, input, select, combobox, heading, toolbar, menu, tab, checkbox,
   *        radio) and drop StaticText/LineBreak/generic divs
   *  4. If still over limit, hard-truncate the biggest message from the middle,
   *     preserving the first and last portions.
   *
   * @param {Array} messages - OpenAI messages array [{role, content}, ...]
   * @returns {Array} - Truncated messages array
   */
  truncateMessages(messages) {
    const totalChars = messages.reduce((sum, m) => sum + (m.content || '').length, 0);

    if (totalChars <= CopilotCliClient.MAX_INPUT_CHARS) {
      return messages; // fits fine
    }

    console.log(`✂️  Messages too large (${totalChars} chars, ~${Math.round(totalChars / CopilotCliClient.CHARS_PER_TOKEN)} tokens). Truncating...`);

    // Work on a deep copy so we don't mutate the original
    const truncated = messages.map(m => ({ ...m }));

    // Find the largest message (the one most likely containing the ARIA tree)
    let largestIdx = 0;
    let largestLen = 0;
    for (let i = 0; i < truncated.length; i++) {
      const len = (truncated[i].content || '').length;
      if (len > largestLen) {
        largestLen = len;
        largestIdx = i;
      }
    }

    let content = truncated[largestIdx].content || '';
    const originalLen = content.length;

    // ── Phase 1: Remove decorative/noise lines ─────────────────────────────
    // Remove box-drawing decorative lines (ΓöüΓöü... and ΓöÇΓöÇ... patterns)
    content = content.replace(/\[[\d-]+\] StaticText: [ΓöüΓöÇ≡ƒ─═╦╗╔╚╝╩╬╠╣║│┌┐└┘├┤┬┴┼▀▄█▐░▒▓■□▪▫●○◆◇★☆]{5,}[^\n]*/g, '');

    // Remove consecutive LineBreak entries — keep max 1 between content nodes
    content = content.replace(/(\[[\d-]+\] LineBreak: \\n\s*\n?\s*){2,}/g, (match) => {
      // Keep just the first LineBreak
      const first = match.match(/\[[\d-]+\] LineBreak: \\n/);
      return first ? first[0] + '\n' : '';
    });

    // Remove standalone LineBreak lines that are just whitespace padding
    content = content.replace(/^\s*\[[\d-]+\] LineBreak: \\n\s*$/gm, '');

    // ── Phase 2: Truncate long StaticText content ──────────────────────────
    content = content.replace(/(\[[\d-]+\] StaticText: )(.{80,})/g, (match, prefix, text) => {
      return prefix + text.substring(0, 80) + '…';
    });

    // Remove empty/whitespace-only StaticText nodes
    content = content.replace(/\[[\d-]+\] StaticText:\s*\\n\s*/g, '');

    // Collapse multiple blank lines into one
    content = content.replace(/\n{3,}/g, '\n\n');

    const afterPhase2 = content.length;
    const otherChars = totalChars - originalLen;
    let currentTotal = otherChars + content.length;

    if (currentTotal <= CopilotCliClient.MAX_INPUT_CHARS) {
      console.log(`✂️  Phase 1-2 sufficient: ${originalLen} → ${content.length} chars (removed ${originalLen - content.length})`);
      truncated[largestIdx].content = content;
      return truncated;
    }

    // ── Phase 3: Keep only actionable elements ─────────────────────────────
    // Parse lines, keep those with actionable roles/types
    const actionableRoles = new Set([
      'button', 'textbox', 'link', 'input', 'select', 'combobox', 'checkbox',
      'radio', 'tab', 'tablist', 'menu', 'menuitem', 'menubar', 'toolbar',
      'heading', 'navigation', 'search', 'dialog', 'alertdialog', 'tree',
      'treeitem', 'listbox', 'option', 'slider', 'switch', 'spinbutton',
      'img', 'group', 'banner', 'main', 'form', 'editor-aria-handler',
    ]);

    const actionablePatterns = /\b(button|textbox|link|input|select|combobox|checkbox|radio|tab|menu|menuitem|toolbar|heading|navigation|search|dialog|tree|treeitem|listbox|option|slider|switch|img|group|form|editor|paragraph)\b/i;

    const lines = content.split('\n');
    const filteredLines = [];
    let keptActionable = 0;
    let droppedNoise = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      // Always keep non-ARIA lines (system prompt text, instructions, etc.)
      if (!trimmed.match(/^\[[\d-]+\]/)) {
        filteredLines.push(line);
        continue;
      }
      // Keep lines with actionable roles
      if (actionablePatterns.test(trimmed)) {
        filteredLines.push(line);
        keptActionable++;
      } else {
        droppedNoise++;
      }
    }

    content = filteredLines.join('\n');
    // Collapse multiple blank lines again
    content = content.replace(/\n{3,}/g, '\n\n');

    currentTotal = otherChars + content.length;
    console.log(`✂️  Phase 3: kept ${keptActionable} actionable nodes, dropped ${droppedNoise} noise nodes (${afterPhase2} → ${content.length} chars)`);

    if (currentTotal <= CopilotCliClient.MAX_INPUT_CHARS) {
      truncated[largestIdx].content = content;
      return truncated;
    }

    // ── Phase 4: Hard truncation — keep first and last portions ────────────
    const budget = CopilotCliClient.MAX_INPUT_CHARS - otherChars;
    const keepFront = Math.floor(budget * 0.6); // 60% from start (system-level context)
    const keepBack = budget - keepFront;         // 40% from end (usually the actionable area)

    const marker = `\n\n[... TRUNCATED ${content.length - budget} chars to fit 16K token limit ...]\n\n`;
    content = content.substring(0, keepFront) + marker + content.substring(content.length - keepBack);

    console.log(`✂️  Phase 4: hard-truncated to ${content.length} chars (budget: ${budget})`);
    truncated[largestIdx].content = content;
    return truncated;
  }

  /**
   * Call the GitHub Models API with the given messages array.
   * Uses standard OpenAI chat completions format.
   * Automatically truncates messages if they exceed the 16K token input limit.
   */
  async callModelsApi(messages, timeoutMs = 120000) {
    const token = await this._getGhToken();
    const url = 'https://models.inference.ai.azure.com/chat/completions';

    // Apply smart truncation if messages are too large for the API
    const truncatedMessages = this.truncateMessages(messages);

    const body = JSON.stringify({
      model: this.modelName,
      messages: truncatedMessages,
    });

    const totalChars = truncatedMessages.reduce((sum, m) => sum + (m.content || '').length, 0);
    console.log(`🤖 Calling GitHub Models API (model: ${this.modelName}, ${truncatedMessages.length} messages, ~${totalChars} chars)...`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (resp.status === 429) {
          const errBody = await resp.text();
          if (attempt < maxRetries) {
            console.log(`⏳ Rate limited (429). Waiting 70 seconds before retry (attempt ${attempt}/${maxRetries})...`);
            console.log(`   Error: ${errBody.substring(0, 200)}`);
            for (let s = 70; s > 0; s -= 10) {
              console.log(`   ⏳ ${s} seconds remaining...`);
              await new Promise(resolve => setTimeout(resolve, Math.min(10000, s * 1000)));
            }
            continue;
          }
          throw new Error(`GitHub Models API error 429 after ${maxRetries} retries: ${errBody}`);
        }

        if (!resp.ok) {
          const errBody = await resp.text();
          throw new Error(`GitHub Models API error ${resp.status}: ${errBody}`);
        }

        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        const cleaned = this.cleanResponse(content);
        const tokens = data.usage?.total_tokens || 0;
        console.log(`✅ GitHub Models API responded (${cleaned.length} chars, ${tokens} tokens)`);

        // Return the full response object with cleaned content
        data.choices[0].message.content = cleaned;
        return data;
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          throw new Error(`GitHub Models API timed out after ${timeoutMs / 1000}s`);
        }
        throw err;
      }
    }
  }
}

/**
 * Setup GitHub Models API as LLM client (free, no rate limits on prompts)
 * Uses `gh auth token` for authentication.
 * @param {string} modelName - Model name (e.g. "gpt-4.1", "gpt-4o")
 * @returns {CustomOpenAIClient} Configured client for Stagehand
 */
function setupCopilotCli(modelName = "gpt-4.1") {
  console.log("🤖 Setting up GitHub Models API...");
  const copilotClient = new CopilotCliClient(modelName);
  const llmClient = new CustomOpenAIClient({
    modelName: modelName,
    client: copilotClient,
  });
  console.log("✅ GitHub Models API ready\n");
  return llmClient;
}

// ── Hybrid Client (trapi-first, GitHub Models API fallback) ─────────────────
/**
 * LLM client that uses Azure OpenAI (trapi) as primary endpoint for speed,
 * and automatically falls back to GitHub Models API when rate-limited (429).
 *
 * This gives the best of both worlds:
 * - Fast responses (~2-5s) when trapi quota is available
 * - Unlimited fallback via GitHub Models API when rate-limited
 */
class HybridClient {
  constructor(modelName = "gpt-4o_2024-11-20") {
    this.modelName = modelName;
    this._rateLimitedUntil = 0; // timestamp when rate limit expires
    this._consecutiveFallbacks = 0;

    // Setup Azure OpenAI client
    const scope = "api://trapi/.default";
    const credential = getBearerTokenProvider(
      new ChainedTokenCredential(
        new AzureCliCredential(),
        new DefaultAzureCredential()
      ),
      scope
    );
    this._azureClient = new AzureOpenAI({
      endpoint: "https://trapi.research.microsoft.com/redmond/interactive",
      azureADTokenProvider: credential,
      apiVersion: "2024-10-21",
    });

    // Setup GitHub Models API fallback
    this._copilotClient = new CopilotCliClient("gpt-4.1");

    // Expose chat.completions.create interface
    this.chat = {
      completions: {
        create: async (params) => {
          return this._createWithFallback(params);
        }
      }
    };
  }

  async _createWithFallback(params) {
    const now = Date.now();

    // If we're still within a known rate-limit window, skip trapi
    if (now < this._rateLimitedUntil) {
      const waitSec = Math.round((this._rateLimitedUntil - now) / 1000);
      console.log(`⏳ trapi rate-limited for ~${waitSec}s more, using GitHub Models API`);
      return this._callCopilotFallback(params);
    }

    // Try trapi first
    try {
      const response = await this._azureClient.chat.completions.create({
        ...params,
        model: this.modelName,
      });
      // Success — reset fallback counter
      if (this._consecutiveFallbacks > 0) {
        console.log(`🔄 trapi recovered after ${this._consecutiveFallbacks} fallback(s)`);
        this._consecutiveFallbacks = 0;
      }
      return response;
    } catch (err) {
      if (this._isRateLimitError(err)) {
        // Parse retry-after header if available
        const retryAfterSec = this._parseRetryAfter(err) || 60;
        this._rateLimitedUntil = Date.now() + retryAfterSec * 1000;
        this._consecutiveFallbacks++;
        console.warn(`⚠️  trapi 429 rate-limited (retry after ${retryAfterSec}s). Falling back to GitHub Models API [#${this._consecutiveFallbacks}]`);
        return this._callCopilotFallback(params);
      }
      // Non-rate-limit error — still try Copilot CLI as last resort
      console.warn(`⚠️  trapi error: ${err.message}. Falling back to GitHub Models API`);
      return this._callCopilotFallback(params);
    }
  }

  async _callCopilotFallback(params) {
    // Route through the CopilotCliClient's chat.completions.create
    return this._copilotClient.chat.completions.create(params);
  }

  _isRateLimitError(err) {
    // Check HTTP status code
    if (err.status === 429 || err.statusCode === 429) return true;
    // Check error message patterns
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return true;
    // Check error code
    if (err.code === 'rate_limit_exceeded' || err.code === '429') return true;
    return false;
  }

  _parseRetryAfter(err) {
    // Try to extract retry-after from error headers or message
    if (err.headers && err.headers['retry-after']) {
      const val = parseInt(err.headers['retry-after'], 10);
      if (!isNaN(val)) return val;
    }
    // Try to extract from error message like "retry after X seconds"
    const match = (err.message || '').match(/retry\s+after\s+(\d+)/i);
    if (match) return parseInt(match[1], 10);
    return null;
  }
}

/**
 * Setup hybrid LLM client (trapi-first, GitHub Models API fallback on 429)
 * @param {string} modelName - Azure model deployment name
 * @returns {CustomOpenAIClient} Configured client for Stagehand
 */
function setupHybrid(modelName = "gpt-4o_2024-11-20") {
  console.log("🔀 Setting up Hybrid LLM (trapi → GitHub Models API fallback)...");
  const hybridClient = new HybridClient(modelName);
  const llmClient = new CustomOpenAIClient({
    modelName: modelName,
    client: hybridClient,
  });
  console.log("✅ Hybrid LLM ready (trapi primary, GitHub Models API fallback)\n");
  return llmClient;
}

/**
 * Setup LLM client (copilot CLI by default)
 * @param {string} provider - "copilot", "hybrid", or "azure"
 * @param {string} modelName - Model name
 * @returns {CustomOpenAIClient} Configured client for Stagehand
 */
function setupLLMClient(provider = "copilot", modelName) {
  if (provider === "hybrid") {
    return setupHybrid(modelName);
  } else if (provider === "copilot") {
    return setupCopilotCli(modelName);
  } else if (provider === "azure") {
    return setupAzureOpenAI();
  } else {
    console.warn(`Unknown provider "${provider}", defaulting to Hybrid`);
    return setupHybrid(modelName);
  }
}

// ── Generic Observe and Act Helper ──────────────────────────────────────────
/**
 * Generic helper to observe then act, recording detailed selector and ARIA info
 * @param {object} stagehand - Stagehand instance
 * @param {object} page - Playwright page instance  
 * @param {PlaywrightRecorder} recorder - Recorder instance
 * @param {string} instruction - Action instruction
 * @param {string} description - Action description
 * @param {number} waitAfterMs - Wait time after action
 */
async function observeAndAct(stagehand, page, recorder, instruction, description, waitAfterMs = 1000) {
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

// ── Aria-Scoped XPath Resolution ─────────────────────────────────────────────
/**
 * Extract ARIA scope information for an element identified by XPath.
 *
 * Algorithm:
 *  (1) Walk up ancestors from the target element to find the nearest
 *      "aria-locatable" ancestor (one with aria-label or id).
 *  (2) Within that ancestor scope, count how many leaf elements share
 *      the same text as the target (textMatchCount).
 *  (3) Compute the xpath-tail — the branch of the original xpath from
 *      the scoping ancestor down to the target element.
 *
 * The caller can then:
 *  - If textMatchCount === 1 → use scope + regex text match (robust)
 *  - If textMatchCount > 1  → use scope + xpath-tail (still shorter/more
 *    maintainable than the full absolute xpath)
 *
 * @param {object} page   - Playwright page instance
 * @param {string} fullXPath - Full xpath (may start with "xpath=")
 * @returns {object|null} { targetText, targetTag, ancestor, textMatchCount, xpathTail }
 */
async function extractAriaScopeForXPath(page, fullXPath) {
  const xpathStr = fullXPath.replace(/^xpath=/, "");
  const xpathParts = xpathStr.replace(/^\//, "").split("/");

  const scopeInfo = await page.evaluate((xpath) => {
    const implicitRoles = {
      button: "button", a: "link",
      input: "textbox", textarea: "textbox", select: "combobox",
      img: "img", nav: "navigation", header: "banner",
      footer: "contentinfo", main: "main", form: "form",
      table: "table",
    };

    // Resolve the target element via the full xpath
    const target = document.evaluate(
      xpath, document, null,
      XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue;
    if (!target) return null;

    // Get target's text content (prefer direct/leaf text)
    let targetText = "";
    if (target.children.length === 0) {
      targetText = (target.textContent || "").trim();
    } else {
      for (const child of target.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          targetText += child.textContent;
        }
      }
      targetText = targetText.trim() || (target.textContent || "").trim();
    }

    const targetTag = target.tagName.toLowerCase();

    // Walk up ancestors to find the nearest aria-locatable one
    let parent = target.parentElement;
    let stepsFromTarget = 0;

    while (parent && parent !== document.documentElement) {
      stepsFromTarget++;
      const ariaLabel = parent.getAttribute("aria-label") || null;
      const role = parent.getAttribute("role")
                   || implicitRoles[parent.tagName.toLowerCase()] || null;
      const id = parent.id || null;

      // An ancestor is "aria-locatable" if it has an aria-label or an id
      if (ariaLabel || id) {
        // Count how many leaf elements within this ancestor have the same text
        let textMatchCount = 0;
        // Build a structural regex that replaces digits with \d+ patterns
        // e.g. "7.9 miles" → /^\d+\.\d+\s*miles$/
        let structuralRegex = null;
        let regexMatchCount = 0;
        if (targetText && /\d/.test(targetText)) {
          const pattern = targetText
            .replace(/\d{1,2}:\d{2}/g, '\\d{1,2}:\\d{2}')
            .replace(/\d+\.\d+/g, '\\d+\\.\\d+')
            .replace(/\d{1,3}(,\d{3})+/g, '[\\d,]+')
            .replace(/(?<!\\d[{+])\d+(?![}\\]\d])/g, '\\d+')
            .replace(/\s+/g, '\\s*');
          try {
            structuralRegex = new RegExp('^' + pattern + '$');
          } catch(e) { /* invalid regex, skip */ }
        }

        if (targetText) {
          const walker = document.createTreeWalker(
            parent, NodeFilter.SHOW_ELEMENT
          );
          let node;
          while ((node = walker.nextNode())) {
            const nodeText = (node.textContent || "").trim();
            if (node.children.length === 0) {
              if (nodeText === targetText) {
                textMatchCount++;
              }
              if (structuralRegex && structuralRegex.test(nodeText)) {
                regexMatchCount++;
              }
            }
          }
        }

        return {
          targetText,
          targetTag,
          ancestor: {
            tagName: parent.tagName.toLowerCase(),
            ariaLabel,
            role,
            id,
            stepsFromTarget,
          },
          textMatchCount,
          regexMatchCount,
        };
      }

      parent = parent.parentElement;
    }

    // No aria-locatable ancestor found
    return { targetText, targetTag, ancestor: null, textMatchCount: 0 };
  }, xpathStr);

  if (!scopeInfo || !scopeInfo.ancestor) return scopeInfo;

  // Compute xpath-tail: the last N segments of the xpath, where
  // N = stepsFromTarget.  This is the relative path from the
  // scoping ancestor down to the target element.
  const steps = scopeInfo.ancestor.stepsFromTarget;
  if (steps > 0 && steps <= xpathParts.length) {
    scopeInfo.xpathTail = xpathParts.slice(xpathParts.length - steps).join("/");
  }

  return scopeInfo;
}

module.exports = {
  PlaywrightRecorder,
  setupAzureOpenAI,
  setupCopilotCli,
  setupHybrid,
  setupLLMClient,
  observeAndAct,
  extractAriaScopeForXPath,
};