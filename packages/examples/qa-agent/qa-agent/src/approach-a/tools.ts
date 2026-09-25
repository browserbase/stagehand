import { tool } from "ai";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "fs";
import type { Stagehand } from "@browserbasehq/stagehand";

export function createTools(stagehand: Stagehand) {
  const page = stagehand.page;
  const consoleLogs: string[] = [];

  // Capture console messages (errors, warnings)
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      consoleLogs.push(`[${type.toUpperCase()}] ${msg.text()}`);
    }
  });

  // Capture page errors
  page.on("pageerror", (err) => {
    consoleLogs.push(`[PAGE_ERROR] ${err.message}`);
  });

  // Capture failed network requests
  page.on("requestfailed", (req) => {
    consoleLogs.push(`[NETWORK_ERROR] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });

  return {
    navigate: tool({
      description:
        "Navigate to a URL in the browser. Use this to go to specific pages of the application.",
      parameters: z.object({
        url: z.string().describe("The full URL to navigate to"),
      }),
      execute: async ({ url }) => {
        try {
          await page.goto(url, { waitUntil: "load", timeout: 60000 });
        } catch (error: any) {
          // Even if timeout occurs, we may still be on the page
          console.log(`Navigation warning: ${error.message?.substring(0, 100)}`);
        }
        try {
          await page.waitForTimeout(2000);
          const title = await page.title();
          const currentUrl = page.url();
          return {
            success: true,
            url: currentUrl,
            title,
            message: `Navigated to ${currentUrl} (title: "${title}")`,
          };
        } catch (error: any) {
          return {
            success: false,
            url,
            error: error.message,
          };
        }
      },
    }),

    act: tool({
      description:
        "Perform a browser action described in natural language. Examples: 'click the Add to Cart button', 'type hello@example.com into the email field', 'scroll down'. Use this for any interaction with the page.",
      parameters: z.object({
        instruction: z.string().describe("Natural language description of the action to perform"),
      }),
      execute: async ({ instruction }) => {
        try {
          await stagehand.act(instruction);
          return { success: true, action: instruction };
        } catch (error: any) {
          return {
            success: false,
            action: instruction,
            error: error.message,
          };
        }
      },
    }),

    extract: tool({
      description:
        "Extract structured data from the current page using AI. Describe what information you want to extract. Returns the extracted data as a JSON object.",
      parameters: z.object({
        instruction: z.string().describe("What data to extract from the current page"),
      }),
      execute: async ({ instruction }) => {
        try {
          const result = await stagehand.extract({
            instruction,
            schema: z.object({
              data: z.any().describe("The extracted data"),
            }),
          });
          return { success: true, extracted: result };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    observe: tool({
      description:
        "Observe the current page and list available interactive elements and possible actions. Use this to understand what's on the page before acting.",
      parameters: z.object({
        instruction: z
          .string()
          .describe(
            "What to look for on the page, e.g. 'find all buttons' or 'find navigation links'",
          ),
      }),
      execute: async ({ instruction }) => {
        try {
          const observations = await stagehand.observe(instruction);
          return { success: true, observations };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    screenshot: tool({
      description:
        "Take a screenshot of the current page. Use this to visually inspect the page for layout issues, broken images, or other visual bugs.",
      parameters: z.object({
        description: z
          .string()
          .optional()
          .describe("Optional note about what to look for in the screenshot"),
      }),
      execute: async ({ description }) => {
        try {
          mkdirSync("screenshots", { recursive: true });
          const filename = `screenshots/screenshot-${Date.now()}.png`;
          const buffer = await page.screenshot({ fullPage: true });
          writeFileSync(filename, buffer);
          // Get page text content for analysis instead of sending huge base64
          const textContent = await page.evaluate(() => {
            return document.body.innerText.substring(0, 3000);
          });
          return {
            success: true,
            savedTo: filename,
            note: description || "Screenshot captured",
            url: page.url(),
            pageText: textContent,
          };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    }),

    get_console_logs: tool({
      description:
        "Get all JavaScript console errors and warnings captured since the session started. Use this to check for runtime errors, failed API calls, and other issues.",
      parameters: z.object({}),
      execute: async () => {
        return {
          logs: [...consoleLogs],
          count: consoleLogs.length,
          message:
            consoleLogs.length > 0
              ? `Found ${consoleLogs.length} console issues`
              : "No console errors detected",
        };
      },
    }),

    check_accessibility: tool({
      description:
        "Run accessibility checks on the current page. Checks for missing alt text, poor color contrast, missing form labels, heading hierarchy issues, and more.",
      parameters: z.object({}),
      execute: async () => {
        const issues = await page.evaluate(() => {
          const problems: string[] = [];

          // Check images without meaningful alt text
          document.querySelectorAll("img").forEach((img, i) => {
            if (!img.alt || img.alt.trim() === "") {
              problems.push(`Image #${i + 1} missing alt text (src: ${img.src.substring(0, 80)})`);
            }
          });

          // Check broken images
          document.querySelectorAll("img").forEach((img, i) => {
            if (!img.complete || img.naturalWidth === 0) {
              problems.push(`Image #${i + 1} failed to load (src: ${img.src.substring(0, 80)})`);
            }
          });

          // Check form inputs without labels
          document.querySelectorAll("input, select, textarea").forEach((el) => {
            const input = el as HTMLInputElement;
            const id = input.id;
            if (id && !document.querySelector(`label[for="${id}"]`)) {
              problems.push(`Input "${id}" (type: ${input.type}) has no associated <label>`);
            }
            if (!id) {
              problems.push(
                `Input (type: ${input.type}) has no id attribute for label association`,
              );
            }
          });

          // Check heading hierarchy
          const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
          for (let i = 1; i < headings.length; i++) {
            const prev = parseInt(headings[i - 1].tagName[1]);
            const curr = parseInt(headings[i].tagName[1]);
            if (curr > prev + 1) {
              problems.push(
                `Heading hierarchy skip: ${headings[i - 1].tagName} → ${headings[i].tagName} ("${(headings[i] as HTMLElement).textContent?.substring(0, 40)}")`,
              );
            }
          }

          // Check for low contrast text (simple heuristic)
          document.querySelectorAll("p, span, a, li, td, th, div").forEach((el) => {
            const style = window.getComputedStyle(el);
            const color = style.color;
            const bg = style.backgroundColor;
            // Check for light gray on white/transparent
            if (color.includes("204, 204, 204") || color === "rgb(204, 204, 204)") {
              if (bg === "rgba(0, 0, 0, 0)" || bg.includes("255, 255, 255")) {
                const text = (el as HTMLElement).textContent?.substring(0, 50)?.trim();
                if (text) {
                  problems.push(`Low contrast text: "${text}..." (color: ${color}, bg: ${bg})`);
                }
              }
            }
          });

          return problems;
        });

        return {
          issues,
          count: issues.length,
          message:
            issues.length > 0
              ? `Found ${issues.length} accessibility issues`
              : "No accessibility issues detected",
        };
      },
    }),

    get_page_url: tool({
      description: "Get the current page URL. Useful to verify navigation worked correctly.",
      parameters: z.object({}),
      execute: async () => {
        return { url: page.url() };
      },
    }),

    check_ux_best_practices: tool({
      description:
        "Run UI/UX best practices checks based on the userinterface.wiki ruleset (152 rules across 12 categories). Checks click target sizes, animation timing, typography, visual design, spacing consistency, z-index layering, and UX law violations.",
      parameters: z.object({}),
      execute: async () => {
        const issues = await page.evaluate(() => {
          const problems: string[] = [];

          // === UX LAWS ===

          // ux-fitts-target-size: Interactive targets min 32px
          document
            .querySelectorAll('a, button, input, select, textarea, [role="button"]')
            .forEach((el) => {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                if (rect.width < 32 || rect.height < 32) {
                  const label =
                    (el as HTMLElement).textContent?.trim().substring(0, 30) || el.tagName;
                  problems.push(
                    `[ux-fitts-target-size] "${label}" is ${Math.round(rect.width)}x${Math.round(rect.height)}px (min 32x32)`,
                  );
                }
              }
            });

          // ux-hicks-minimize-choices: Flag nav/menus with >7 visible options
          document.querySelectorAll("nav, [role=menu], [role=menubar]").forEach((nav) => {
            const links = nav.querySelectorAll("a, button");
            if (links.length > 7) {
              problems.push(
                `[ux-hicks-minimize-choices] Navigation has ${links.length} items (consider grouping, max ~7)`,
              );
            }
          });

          // ux-millers-chunking: Flag long lists without grouping
          document.querySelectorAll("ul, ol").forEach((list) => {
            const items = list.children.length;
            if (items > 9) {
              problems.push(
                `[ux-millers-chunking] List has ${items} items without visual chunking (group into 5-9)`,
              );
            }
          });

          // === VISUAL DESIGN ===

          // visual-consistent-spacing-scale: Check for inconsistent gaps
          const spacings = new Set<string>();
          document.querySelectorAll("div, section, main").forEach((el) => {
            const style = window.getComputedStyle(el);
            const gap = style.gap;
            if (gap && gap !== "normal") spacings.add(gap);
          });
          if (spacings.size > 6) {
            problems.push(
              `[visual-consistent-spacing-scale] Found ${spacings.size} different gap values — use a consistent spacing scale`,
            );
          }

          // visual-no-pure-black-shadow: Check for pure black box-shadows
          document.querySelectorAll("*").forEach((el) => {
            const style = window.getComputedStyle(el);
            const shadow = style.boxShadow;
            if (shadow && shadow !== "none") {
              if (shadow.includes("rgb(0, 0, 0)") && !shadow.includes("rgba(0, 0, 0,")) {
                problems.push(
                  `[visual-no-pure-black-shadow] Element uses pure black shadow — use rgba/neutral color instead`,
                );
              }
            }
          });

          // staging-z-index-hierarchy: Check for problematic z-index values
          const zIndexes: { el: string; z: number }[] = [];
          document.querySelectorAll("*").forEach((el) => {
            const style = window.getComputedStyle(el);
            const z = parseInt(style.zIndex);
            if (!isNaN(z) && z !== 0) {
              const tag = el.tagName.toLowerCase();
              const cls = (el as HTMLElement).className?.toString().substring(0, 30) || "";
              zIndexes.push({ el: `${tag}.${cls}`, z });
            }
          });
          const negativeZ = zIndexes.filter((z) => z.z < 0);
          if (negativeZ.length > 0) {
            negativeZ.forEach((z) => {
              problems.push(
                `[staging-z-index-hierarchy] Negative z-index (${z.z}) on ${z.el} — may render behind content`,
              );
            });
          }

          // === TYPOGRAPHY ===

          // type-tabular-nums-for-data: Prices/numbers should use tabular-nums
          document.querySelectorAll("*").forEach((el) => {
            const text = (el as HTMLElement).innerText || "";
            if (/\$[\d,.]+/.test(text) && el.children.length === 0) {
              const style = window.getComputedStyle(el);
              const fontFeature = style.fontFeatureSettings;
              const fontVariant = style.fontVariantNumeric;
              if (!fontFeature?.includes("tnum") && fontVariant !== "tabular-nums") {
                problems.push(
                  `[type-tabular-nums-for-data] Price "${text.trim().substring(0, 20)}" should use font-variant-numeric: tabular-nums`,
                );
              }
            }
          });

          // type-antialiased-on-retina: Check for font smoothing
          const bodyStyle = window.getComputedStyle(document.body);
          const smoothing =
            (bodyStyle as any).webkitFontSmoothing || (bodyStyle as any).MozOsxFontSmoothing;
          if (!smoothing || smoothing === "auto") {
            problems.push(
              `[type-antialiased-on-retina] Body missing -webkit-font-smoothing: antialiased`,
            );
          }

          // type-text-wrap-balance-headings: Headings should have text-wrap: balance
          document.querySelectorAll("h1, h2, h3").forEach((h) => {
            const style = window.getComputedStyle(h);
            const wrap = (style as any).textWrap;
            if (wrap !== "balance") {
              const text = (h as HTMLElement).textContent?.substring(0, 30);
              problems.push(
                `[type-text-wrap-balance-headings] "${text}" missing text-wrap: balance`,
              );
            }
          });

          // === ANIMATION ===

          // physics-active-state: Buttons should have :active transform
          // (Check if any transitions exist on buttons)
          document.querySelectorAll("button, a.btn, [role=button]").forEach((btn) => {
            const style = window.getComputedStyle(btn);
            const transition = style.transition;
            const transform = style.transform;
            if (
              (!transition ||
                transition === "all 0s ease 0s" ||
                transition === "none 0s ease 0s") &&
              (!transform || transform === "none")
            ) {
              const label = (btn as HTMLElement).textContent?.trim().substring(0, 20);
              if (label) {
                problems.push(
                  `[physics-active-state] Button "${label}" has no transition/transform — add :active scale`,
                );
              }
            }
          });

          // === INTERACTION ===

          // ux-postels-accept-messy-input: Check input types
          document.querySelectorAll("input").forEach((input) => {
            const el = input as HTMLInputElement;
            if (
              el.type === "text" &&
              (el.name?.includes("email") ||
                el.id?.includes("email") ||
                el.placeholder?.toLowerCase().includes("email"))
            ) {
              problems.push(
                `[ux-postels-accept-messy-input] Input "${el.name || el.id}" looks like email but has type="text" — use type="email"`,
              );
            }
            if (
              el.type === "text" &&
              (el.name?.includes("phone") ||
                el.id?.includes("phone") ||
                el.placeholder?.toLowerCase().includes("phone"))
            ) {
              problems.push(
                `[ux-postels-accept-messy-input] Input "${el.name || el.id}" looks like phone but has type="text" — use type="tel"`,
              );
            }
          });

          // pseudo-hit-target-expansion: Check disabled buttons that look enabled
          document.querySelectorAll("button[disabled]").forEach((btn) => {
            const style = window.getComputedStyle(btn);
            const opacity = parseFloat(style.opacity);
            const cursor = style.cursor;
            if (opacity > 0.8 && cursor !== "not-allowed") {
              const label = (btn as HTMLElement).textContent?.trim().substring(0, 30);
              problems.push(
                `[pseudo-hit-target-expansion] Disabled button "${label}" lacks visual indicator (opacity: ${opacity}, cursor: ${cursor})`,
              );
            }
          });

          // ux-progressive-disclosure: Check for forms with >6 visible fields
          document.querySelectorAll("form").forEach((form) => {
            const visibleInputs = Array.from(
              form.querySelectorAll("input:not([type=hidden]), select, textarea"),
            ).filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            if (visibleInputs.length > 6) {
              problems.push(
                `[ux-progressive-disclosure] Form has ${visibleInputs.length} visible fields — consider progressive disclosure or sections`,
              );
            }
          });

          return problems;
        });

        // Deduplicate similar issues
        const uniqueIssues = [...new Set(issues)].slice(0, 50);

        return {
          issues: uniqueIssues,
          count: uniqueIssues.length,
          message:
            uniqueIssues.length > 0
              ? `Found ${uniqueIssues.length} UI/UX best practice violations`
              : "No UI/UX violations detected",
          source: "userinterface.wiki (152 rules, 12 categories)",
        };
      },
    }),
  };
}
