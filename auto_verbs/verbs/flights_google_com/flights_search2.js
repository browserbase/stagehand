const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Google Flights – Round Trip Flight Search (v2)
 *
 * Steps 1–5 use deterministic Playwright locators (no AI exploration).
 * Step 6 uses AI-driven extraction to discover flight number, itinerary, and price.
 * Generates a Python Playwright script.
 */

// ── Configuration ────────────────────────────────────────────────────────────
function computeDates() {
  const today = new Date();
  const departure = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const returnDate = new Date(departure);
  returnDate.setDate(returnDate.getDate() + 4);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const fmtDisplay = (d) => `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
  const fmtSlash = (d) => `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
  const monthName = (d) => d.toLocaleString("en-US", { month: "long" });
  const monthYear = (d) => `${monthName(d)} ${d.getFullYear()}`;
  return {
    departureDate: departure,
    returnDateObj: returnDate,
    departure: fmt(departure),
    returnDate: fmt(returnDate),
    departureDisplay: fmtDisplay(departure),
    returnDisplay: fmtDisplay(returnDate),
    departureSlash: fmtSlash(departure),
    returnSlash: fmtSlash(returnDate),
    depDay: departure.getDate(),
    retDay: returnDate.getDate(),
    depMonthName: monthName(departure),
    retMonthName: monthName(returnDate),
    depMonthYear: monthYear(departure),
    retMonthYear: monthYear(returnDate),
  };
}
const dates = computeDates();

const CFG = {
  url: "https://www.google.com/travel/flights",
  origin: "Seattle",
  destination: "Chicago",
  departure: dates.departure,
  returnDate: dates.returnDate,
  departureDisplay: dates.departureDisplay,
  returnDisplay: dates.returnDisplay,
  departureSlash: dates.departureSlash,
  returnSlash: dates.returnSlash,
  depDay: dates.depDay,
  retDay: dates.retDay,
  depMonthName: dates.depMonthName,
  retMonthName: dates.retMonthName,
  depMonthYear: dates.depMonthYear,
  retMonthYear: dates.retMonthYear,
  maxResults: 5,
  waits: { page: 3000, type: 2000, select: 1000, search: 5000 },
};

// ═══════════════════════════════════════════════════════════════════════════
// Steps 1–5: Deterministic Playwright (no AI)
// ═══════════════════════════════════════════════════════════════════════════

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  for (const text of ["Accept all", "I agree", "Accept", "Got it"]) {
    try {
      const btn = page.locator(`button:has-text("${text}")`).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        console.log(`   ✅ Dismissed: "${text}"`);
      }
    } catch (e) { /* no popup */ }
  }
  await page.waitForTimeout(500);
}

async function ensureRoundTrip(page, recorder) {
  console.log("🎯 STEP 1: Ensure Round Trip...");
  try {
    const tripText = await page.evaluate(() => {
      const spans = document.querySelectorAll("span");
      for (const s of spans) {
        const t = s.innerText.trim().toLowerCase();
        if (t === "round trip" || t === "one way" || t === "multi-city") return t;
      }
      return "";
    });
    if (tripText.includes("round trip")) {
      console.log("   ✅ Already Round Trip");
    } else {
      const tripBtn = page.locator(
        '[aria-label*="trip" i], button:has-text("One way"), button:has-text("Multi-city")'
      ).first();
      await tripBtn.click();
      await page.waitForTimeout(500);
      await page.locator('li:has-text("Round trip"), [data-value="1"]').first().click();
      await page.waitForTimeout(500);
      console.log("   ✅ Selected Round Trip");
    }
    recorder.record("act", { instruction: "Ensure Round Trip", description: "Trip type verified", method: "click" });
  } catch (e) {
    console.log(`   ⚠️  Round Trip check skipped: ${e.message}`);
  }
}

async function setOrigin(page, recorder, origin) {
  console.log(`🎯 STEP 2: Origin = "${origin}"...`);
  try {
    const originEl = page.locator(
      'div[aria-label*="Where from" i], input[aria-label*="Where from" i]'
    ).first();
    await originEl.click();
    await page.waitForTimeout(500);

    await page.keyPress("Ctrl+a");
    await page.waitForTimeout(200);
    await page.type(origin, { delay: 50 });
    console.log(`   ✅ Typed "${origin}"`);
    await page.waitForTimeout(1500);

    try {
      await page.waitForSelector('ul[role="listbox"] li', { state: "visible", timeout: 5000 });
      const suggestion = page.locator('ul[role="listbox"] li').first();
      await suggestion.click();
      console.log("   ✅ Selected origin suggestion");
    } catch (e) {
      await page.keyPress("Enter");
      console.log("   ⚠️  Pressed Enter (no dropdown)");
    }
    await page.waitForTimeout(1000);
    recorder.record("act", { instruction: `Set origin: ${origin}`, description: `Origin: ${origin}`, method: "type" });
  } catch (e) {
    console.log(`   ⚠️  Origin input issue: ${e.message}`);
  }
}

async function setDestination(page, recorder, destination) {
  console.log(`🎯 STEP 3: Destination = "${destination}"...`);
  try {
    const destFocused = await page.evaluate(() => {
      const el = document.activeElement;
      if (el && el.tagName === "INPUT") {
        const ph = (el.placeholder || "").toLowerCase();
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        return ph.includes("where to") || lbl.includes("where to");
      }
      return false;
    });

    if (destFocused) {
      console.log("   Destination auto-focused after origin");
    } else {
      const clicked = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[role="combobox"]');
        for (const inp of inputs) {
          const ph = (inp.placeholder || "").toLowerCase();
          const lbl = (inp.getAttribute("aria-label") || "").toLowerCase();
          if (ph.includes("where to") || lbl.includes("where to")) {
            const rect = inp.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
              inp.focus();
              inp.click();
              return true;
            }
          }
        }
        return false;
      });
      if (clicked) {
        console.log("   Clicked destination input via JS");
      } else {
        await page.locator('input[aria-label*="Where to" i]').first().click();
        console.log("   Force-clicked destination input");
      }
    }

    await page.waitForTimeout(500);
    await page.keyPress("Ctrl+a");
    await page.waitForTimeout(200);
    await page.type(destination, { delay: 50 });
    console.log(`   ✅ Typed "${destination}"`);
    await page.waitForTimeout(1500);

    try {
      await page.waitForSelector('ul[role="listbox"] li', { state: "visible", timeout: 5000 });
      const suggestion = page.locator('ul[role="listbox"] li').first();
      await suggestion.click();
      console.log("   ✅ Selected destination suggestion");
    } catch (e) {
      await page.keyPress("Enter");
      console.log("   ⚠️  Pressed Enter (no dropdown)");
    }
    await page.waitForTimeout(1000);
    recorder.record("act", { instruction: `Set destination: ${destination}`, description: `Destination: ${destination}`, method: "type" });
  } catch (e) {
    console.log(`   ⚠️  Destination input issue: ${e.message}`);
  }
}

async function setDates(page, recorder) {
  console.log(`🎯 STEP 4: Dates — Departure: ${CFG.departureDisplay}, Return: ${CFG.returnDisplay}...`);

  // Open calendar via departure date field
  let dateOpened = false;
  for (const sel of ['[aria-label*="Departure" i]', 'input[placeholder*="Departure" i]']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        dateOpened = true;
        console.log("   Opened calendar via departure field");
        break;
      }
    } catch (e) { continue; }
  }
  if (!dateOpened) console.log("   ⚠️  Could not open calendar");
  await page.waitForTimeout(1500);

  if (dateOpened) {
    // Navigate calendar forward until departure month is visible
    for (let i = 0; i < 24; i++) {
      const calText = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return d ? d.innerText : "";
      }) || "";
      if (calText.includes(CFG.depMonthYear)) break;
      const went = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return false;
        const btns = d.querySelectorAll("button");
        for (const b of btns) {
          const lbl = (b.getAttribute("aria-label") || "").toLowerCase();
          if (lbl.includes("next")) { b.click(); return true; }
        }
        return false;
      });
      if (!went) break;
      await page.waitForTimeout(400);
    }
    console.log(`   Calendar shows ${CFG.depMonthYear}`);
    await page.waitForTimeout(500);

    // Click departure day
    const depClicked = await page.evaluate(({ day, monthName }) => {
      const candidates = [];
      const btns = document.querySelectorAll('[role="button"]');
      for (const btn of btns) {
        const firstLine = (btn.innerText || "").split("\n")[0].trim();
        if (firstLine === String(day)) candidates.push(btn);
      }
      if (candidates.length === 0) return "no_day_btn";
      for (const btn of candidates) {
        let el = btn.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!el) break;
          if (el.getAttribute("role") === "rowgroup") {
            const txt = (el.innerText || "").split("\n")[0].trim();
            if (txt === monthName) { btn.click(); return "clicked"; }
            break;
          }
          el = el.parentElement;
        }
      }
      return "no_match";
    }, { day: CFG.depDay, monthName: CFG.depMonthName });

    if (depClicked === "clicked") console.log(`   ✅ Selected departure day ${CFG.depDay}`);
    else console.log(`   ⚠️  Could not click departure day ${CFG.depDay} (${depClicked})`);
    await page.waitForTimeout(1000);

    // Navigate to return month if different
    if (CFG.retMonthYear !== CFG.depMonthYear) {
      for (let i = 0; i < 6; i++) {
        const calText = await page.evaluate(() => document.body.innerText.substring(0, 5000)) || "";
        if (calText.includes(CFG.retMonthYear)) break;
        await page.evaluate(() => {
          const btns = document.querySelectorAll("button");
          for (const b of btns) {
            const lbl = (b.getAttribute("aria-label") || "").toLowerCase();
            if (lbl.includes("next")) { b.click(); return; }
          }
        });
        await page.waitForTimeout(400);
      }
    }

    // Click return day
    const retClicked = await page.evaluate(({ day, monthName }) => {
      const candidates = [];
      const btns = document.querySelectorAll('[role="button"]');
      for (const btn of btns) {
        const firstLine = (btn.innerText || "").split("\n")[0].trim();
        if (firstLine === String(day)) candidates.push(btn);
      }
      if (candidates.length === 0) return "no_day_btn";
      for (const btn of candidates) {
        let el = btn.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!el) break;
          if (el.getAttribute("role") === "rowgroup") {
            const txt = (el.innerText || "").split("\n")[0].trim();
            if (txt === monthName) { btn.click(); return "clicked"; }
            break;
          }
          el = el.parentElement;
        }
      }
      return "no_match";
    }, { day: CFG.retDay, monthName: CFG.retMonthName });

    if (retClicked === "clicked") console.log(`   ✅ Selected return day ${CFG.retDay}`);
    else console.log(`   ⚠️  Could not click return day ${CFG.retDay} (${retClicked})`);
    await page.waitForTimeout(500);
  }

  // Click Done if visible
  const doneResult = await page.evaluate(() => {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      const txt = (b.innerText || "").trim();
      if (txt === "Done" && b.offsetParent !== null) { b.click(); return "clicked"; }
    }
    return "not_found";
  });
  console.log(`   Done button: ${doneResult}`);
  await page.waitForTimeout(1000);

  recorder.record("act", {
    instruction: `Set dates: dep=${CFG.departureDisplay} ret=${CFG.returnDisplay}`,
    description: "Set departure and return dates",
    method: "calendar",
  });
}

async function clickSearch(page, recorder) {
  console.log("🎯 STEP 5: Search...");
  const searchResult = await page.evaluate(() => {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      const txt = (b.innerText || "").trim().toLowerCase();
      if ((txt === "search" || aria.includes("search")) && b.offsetParent !== null) {
        b.click();
        return "clicked";
      }
    }
    return "not_found";
  });
  console.log(`   Search button: ${searchResult}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(8000);

  try {
    await page.waitForSelector('span:has-text("$")', { state: "visible", timeout: 10000 });
    console.log("   ✅ Results loaded (price found)");
  } catch (e) {
    console.log("   ⚠️  Timeout waiting for price — continuing anyway");
  }
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(2000);
  console.log(`   📍 URL: ${page.url()}`);
  recorder.record("act", { instruction: "Click Search", description: "Search flights", method: "click" });
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 6: AI-driven exploration to find flight number, itinerary, and price
// ═══════════════════════════════════════════════════════════════════════════

async function extractFlightsAI(stagehand, page, recorder) {
  console.log(`\n🤖 STEP 6: AI exploration — extract up to ${CFG.maxResults} flights...`);
  console.log("   (Expanding each card to find flight numbers)\n");

  const { z } = require("zod/v3");

  // ── Helper: IATA airline code set for regex matching ───────────────────
  //  NOTE: "AM" (AeroMexico) excluded — causes false positives from time strings
  //        like "7:15 AM 1:23 PM" being parsed as "AM 1".
  const AIRLINE_CODES = [
    "AA","AS","B6","DL","F9","G4","HA","NK","UA","WN",
    "AC","WS","BA","LH","AF","KL","IB","SK","AY","LX",
    "QF","NZ","SQ","CX","NH","JL","KE","OZ",
    "EK","QR","EY","TK","ET","LA","AV","CM",
  ];

  // ── 6a: Extract basic info (airline, itinerary, price) from summary ────
  console.log("   🤖 Extracting basic flight info from result cards...");
  const basicInfo = await stagehand.extract(
    `Extract the top ${CFG.maxResults} flight results visible on this Google Flights search results page.
For each flight extract:
1. airline: The airline name (e.g. "Alaska", "United", "Delta").
2. itinerary: departure time – arrival time, duration, stops (e.g. "12:29 AM – 6:40 AM · 4 hr 11 min · Nonstop").
3. price: Economy class price as displayed (e.g. "$197").
Only extract real flight results, not ads or headers.`,
    z.object({
      flights: z.array(z.object({
        airline: z.string().describe("Airline name"),
        itinerary: z.string().describe("Times, duration, stops"),
        price: z.string().describe("Economy price"),
      })).describe(`Up to ${CFG.maxResults} flight results`),
    })
  );

  console.log(`   📋 Basic info for ${basicInfo.flights.length} flights extracted`);

  // ── 6b: Expand each card to get flight number(s) ──────────────────────
  //
  //  Strategy: use page.evaluate() to find the [aria-expanded] toggle for
  //  each flight card, build an XPath, then page.locator(xpath).click()
  //  for trusted Playwright events. This is deterministic — no LLM needed
  //  for the click itself. stagehand.act() was non-deterministic and
  //  sometimes selected the flight (navigating away) instead of expanding.
  //
  const flights = [];
  const cardCount = Math.min(basicInfo.flights.length, CFG.maxResults);

  // ── Pre-discover all expand toggles ────────────────────────────────
  console.log("\n   🔍 Finding expand toggles for each flight card...");
  const toggleInfos = await page.evaluate(() => {
    // Helper: build an XPath for a DOM element
    function getXPath(el) {
      const parts = [];
      while (el && el !== document.documentElement && el !== document) {
        let idx = 1;
        let sib = el.previousElementSibling;
        while (sib) {
          if (sib.tagName === el.tagName) idx++;
          sib = sib.previousElementSibling;
        }
        parts.unshift(el.tagName.toLowerCase() + "[" + idx + "]");
        el = el.parentElement;
      }
      return "/html/" + parts.join("/");
    }

    // Find all <li> elements that look like flight result cards
    const allLi = Array.from(document.querySelectorAll("ul > li"));
    const flightLis = allLi.filter(li => {
      const t = li.innerText || "";
      return /\d{1,2}:\d{2}/.test(t) && t.length > 30 && t.length < 800;
    });

    return flightLis.map((li, idx) => {
      const toggle = li.querySelector("[aria-expanded]");
      if (!toggle) return { idx, hasToggle: false };
      return {
        idx,
        hasToggle: true,
        xpath: getXPath(toggle),
        expanded: toggle.getAttribute("aria-expanded"),
        tag: toggle.tagName.toLowerCase(),
        snippet: (li.innerText || "").substring(0, 60).replace(/\n/g, " "),
      };
    });
  });

  console.log(`   📋 Found ${toggleInfos.length} flight cards, ${toggleInfos.filter(t => t.hasToggle).length} with expand toggles`);
  for (const t of toggleInfos.slice(0, 6)) {
    console.log(`      [${t.idx}] ${t.hasToggle ? `✅ ${t.tag} aria-expanded=${t.expanded}` : "❌ no toggle"} — ${t.snippet || ""}`);
  }

  for (let i = 0; i < cardCount; i++) {
    const basic = basicInfo.flights[i];
    console.log(`\n   📂 [${i + 1}/${cardCount}] Expanding: ${basic.airline} ${basic.itinerary} — ${basic.price}`);

    try {
      // ── Snapshot flight-number spans BEFORE expanding ───────────────
      const spansBefore = await page.evaluate((codes) => {
        const codeSet = new Set(codes);
        const nums = [];
        for (const sp of document.querySelectorAll("span")) {
          const t = (sp.textContent || "").trim();
          if (/^[A-Z]{2}\s*\d{1,4}$/.test(t) && codeSet.has(t.substring(0, 2)))
            nums.push(t.replace(/\s+/g, " "));
        }
        return nums;
      }, AIRLINE_CODES);
      const spansBeforeSet = new Set(spansBefore);

      const textBeforeLen = await page.evaluate(() => (document.body.innerText || "").length);

      // ── Click the expand toggle deterministically ───────────────────
      const toggleInfo = i < toggleInfos.length ? toggleInfos[i] : null;
      if (toggleInfo && toggleInfo.hasToggle) {
        const xpath = toggleInfo.xpath;
        console.log(`      🖱️  Clicking toggle: xpath=${xpath} (${toggleInfo.tag}, expanded=${toggleInfo.expanded})`);
        try {
          await page.locator(`xpath=${xpath}`).click();
        } catch (locErr) {
          console.log(`      ⚠️  locator.click failed: ${locErr.message}, trying evaluate click...`);
          await page.evaluate((xp) => {
            const result = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const el = result.singleNodeValue;
            if (el) el.click();
          }, xpath);
        }
      } else {
        // Fallback: use stagehand.act() if no toggle found
        console.log(`      ⚠️  No toggle found for card ${i + 1}, using stagehand.act()...`);
        const ordinals = ["first", "second", "third", "fourth", "fifth"];
        const ordinal = ordinals[i] || `${i + 1}th`;
        await stagehand.act(`Click the small expand arrow or dropdown toggle on the ${ordinal} flight result to show its details. Do NOT click the main flight link.`);
      }
      await page.waitForTimeout(3000);

      // ── Check expansion success ─────────────────────────────────────
      const afterLen1 = await page.evaluate(() => (document.body.innerText || "").length);
      const delta1 = afterLen1 - textBeforeLen;
      console.log(`      DOM delta after click: ${delta1 > 0 ? "+" : ""}${delta1} chars`);

      if (delta1 <= 0 && toggleInfo && toggleInfo.hasToggle) {
        // Toggle click might have collapsed instead of expanded; retry
        console.log(`      ⚠️  Didn't expand, clicking toggle again...`);
        try {
          await page.locator(`xpath=${toggleInfo.xpath}`).click();
        } catch (e) {
          await page.evaluate((xp) => {
            const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            if (r.singleNodeValue) r.singleNodeValue.click();
          }, toggleInfo.xpath);
        }
        await page.waitForTimeout(3000);
      }

      // ── Snapshot spans AFTER expansion ──────────────────────────────
      const extractResult = await page.evaluate((codes) => {
        const codeSet = new Set(codes);
        const bodyText = document.body.innerText || "";

        const allSpanNums = [];
        for (const sp of document.querySelectorAll("span")) {
          const t = (sp.textContent || "").trim();
          if (/^[A-Z]{2}\s*\d{1,4}$/.test(t) && codeSet.has(t.substring(0, 2)))
            allSpanNums.push(t.replace(/\s+/g, " "));
        }

        const findNums = (txt) => {
          const out = new Set();
          for (const m of txt.matchAll(/\b([A-Z]{2})\s+(\d{1,4})\b/g)) {
            if (codeSet.has(m[1])) out.add(m[1] + " " + m[2]);
          }
          for (const m of txt.matchAll(/\b([A-Z]{2})(\d{3,4})\b/g)) {
            if (codeSet.has(m[1])) out.add(m[1] + " " + m[2]);
          }
          return [...out];
        };
        const fromFullText = findNums(bodyText);

        const fromAria = [];
        for (const el of document.querySelectorAll("[aria-label]")) {
          fromAria.push(...findNums(el.getAttribute("aria-label") || ""));
        }

        return {
          allSpanNums,
          fromFullText,
          fromAria: [...new Set(fromAria)],
          bodyLen: bodyText.length,
        };
      }, AIRLINE_CODES);

      const delta = extractResult.bodyLen - textBeforeLen;
      console.log(`      All spans now: [${extractResult.allSpanNums}]`);
      console.log(`      Spans before:  [${spansBefore}]`);

      // ── Diff spans: find NEW flight numbers that appeared ──────────
      const newSpans = extractResult.allSpanNums.filter(s => !spansBeforeSet.has(s));
      const uniqueNewSpans = [...new Set(newSpans)];
      console.log(`      New spans:     [${uniqueNewSpans}]`);

      // ── Pick best flight number source ─────────────────────────────
      let flightNum = "N/A";

      if (uniqueNewSpans.length > 0) {
        flightNum = uniqueNewSpans.slice(0, 3).join(" / ");
      } else if (delta > 100) {
        const fullTextNew = extractResult.fromFullText.filter(s => !spansBeforeSet.has(s));
        if (fullTextNew.length > 0) {
          flightNum = [...new Set(fullTextNew)].slice(0, 3).join(" / ");
        }
      }

      // ── Fallback: use Stagehand AI extraction ──────────────────────
      if (flightNum === "N/A") {
        console.log(`      🤖 No new flight numbers found — trying AI extraction...`);
        try {
          const ordinals2 = ["first", "second", "third", "fourth", "fifth"];
          const aiResult = await stagehand.extract(
            `Look at the currently expanded flight detail panel on this Google Flights page.
Extract the flight number(s) for the ${basic.airline} flight.
Flight numbers look like "AS 330", "UA 1891", "DL 2247", etc.`,
            z.object({
              flightNumbers: z.array(z.string()).describe("Flight number(s) like 'AS 330', 'DL 2247'"),
            })
          );
          if (aiResult.flightNumbers && aiResult.flightNumbers.length > 0) {
            flightNum = aiResult.flightNumbers.slice(0, 3).join(" / ");
            console.log(`      🤖 AI extracted: ${flightNum}`);
          }
        } catch (aiErr) {
          console.log(`      ⚠️  AI extraction failed: ${aiErr.message}`);
        }
      }

      console.log(`      ✅ Flight number: ${flightNum}`);

      flights.push({
        flightNumber: flightNum,
        itinerary: `${basic.airline} · ${basic.itinerary}`,
        price: basic.price,
      });

      // ── Collapse the card ──────────────────────────────────────────
      //    Click the same toggle again (it's now aria-expanded="true")
      if (toggleInfo && toggleInfo.hasToggle) {
        try {
          await page.locator(`xpath=${toggleInfo.xpath}`).click();
          await page.waitForTimeout(1500);
        } catch (collapseErr) {
          console.log(`      ⚠️  Collapse failed: ${collapseErr.message}`);
          await page.keyPress("Escape");
          await page.waitForTimeout(1000);
        }
      } else {
        await page.keyPress("Escape");
        await page.waitForTimeout(1000);
      }

    } catch (err) {
      console.log(`      ⚠️  Failed to expand card ${i + 1}: ${err.message}`);
      flights.push({
        flightNumber: "N/A",
        itinerary: `${basic.airline} · ${basic.itinerary}`,
        price: basic.price,
      });
    }
  }

  const result = { flights };

  recorder.record("extract", {
    instruction: "AI extraction: expanded each card for flight numbers",
    description: `Extracted ${flights.length} flights with flight numbers`,
    results: result,
  });

  console.log(`\n📋 Found ${flights.length} flights:\n`);
  flights.forEach((f, i) => {
    console.log(`   ${i + 1}. ✈️  ${f.flightNumber}`);
    console.log(`      📄 ${f.itinerary}`);
    console.log(`      💰 ${f.price} (Economy)`);
  });

  return result;
}

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Google Flights – Round Trip Flight Search (v2)
Origin: ${cfg.origin} → Destination: ${cfg.destination}
Departure: ${cfg.departureDisplay}  Return: ${cfg.returnDisplay}

Generated on: ${ts}
Recorded ${n} browser interactions

Steps 1-5: Deterministic Playwright locators (no AI).
Step 6: Uses JS extraction to find flight number, itinerary, and price.
"""

import re
import os, sys, shutil
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def compute_dates():
    today = date.today()
    departure = today + relativedelta(months=2)
    ret = departure + timedelta(days=4)
    return departure, ret


def run(
    playwright: Playwright,
    origin: str = "${cfg.origin}",
    destination: str = "${cfg.destination}",
    max_results: int = ${cfg.maxResults},
) -> list:
    departure, return_date = compute_dates()
    dep_str = departure.strftime("%Y-%m-%d")
    ret_str = return_date.strftime("%Y-%m-%d")
    dep_display = departure.strftime("%m/%d/%Y")
    ret_display = return_date.strftime("%m/%d/%Y")

    print(f"  {origin} → {destination}")
    print(f"  Departure: {dep_display}  Return: {ret_display}\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("flights_google_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate ──────────────────────────────────────────────────────
        print("Loading Google Flights...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss cookie/consent banners ────────────────────────────────
        for selector in [
            "button:has-text('Accept all')",
            "button:has-text('I agree')",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 1: Ensure Round Trip ─────────────────────────────────────
        print("STEP 1: Ensuring Round Trip...")
        try:
            trip_text = page.evaluate('''() => {
                const spans = document.querySelectorAll('span');
                for (const s of spans) {
                    const t = s.innerText.trim().toLowerCase();
                    if (t === 'round trip' || t === 'one way' || t === 'multi-city') {
                        return t;
                    }
                }
                return '';
            }''')
            if 'round trip' in trip_text:
                print("  Already Round Trip")
            else:
                trip_btn = page.locator(
                    '[aria-label*="trip" i], '
                    'button:has-text("One way"), '
                    'button:has-text("Multi-city")'
                ).first
                trip_btn.evaluate("el => el.click()")
                page.wait_for_timeout(500)
                page.locator('li:has-text("Round trip"), [data-value="1"]').first.evaluate("el => el.click()")
                page.wait_for_timeout(500)
                print("  Selected Round Trip")
        except Exception as e:
            print(f"  Round Trip check skipped: {e}")

        # ── STEP 2: Set Origin ────────────────────────────────────────────
        print(f'STEP 2: Origin = "{origin}"...')
        try:
            origin_el = page.locator(
                'div[aria-label*="Where from" i], '
                'input[aria-label*="Where from" i]'
            ).first
            origin_el.evaluate("el => el.click()")
            page.wait_for_timeout(500)
            page.keyboard.press("Control+a")
            page.wait_for_timeout(200)
            page.keyboard.type(origin, delay=50)
            print(f'  Typed "{origin}"')
            page.wait_for_timeout(1500)
            try:
                suggestion = page.locator('ul[role="listbox"] li').first
                suggestion.wait_for(state="visible", timeout=5000)
                suggestion.evaluate("el => el.click()")
                print("  Selected origin suggestion")
            except Exception:
                page.keyboard.press("Enter")
                print("  Pressed Enter (no dropdown)")
            page.wait_for_timeout(1000)
        except Exception as e:
            print(f"  Origin input issue: {e}")

        # ── STEP 3: Set Destination ───────────────────────────────────────
        print(f'STEP 3: Destination = "{destination}"...')
        try:
            dest_focused = page.evaluate('''() => {
                const el = document.activeElement;
                if (el && el.tagName === 'INPUT') {
                    const ph = (el.placeholder || '').toLowerCase();
                    const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
                    return ph.includes('where to') || lbl.includes('where to');
                }
                return false;
            }''')
            if dest_focused:
                print("  Destination auto-focused after origin")
            else:
                clicked = page.evaluate('''() => {
                    const inputs = document.querySelectorAll('input[role="combobox"]');
                    for (const inp of inputs) {
                        const ph = (inp.placeholder || '').toLowerCase();
                        const lbl = (inp.getAttribute('aria-label') || '').toLowerCase();
                        if (ph.includes('where to') || lbl.includes('where to')) {
                            const rect = inp.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
                                inp.focus();
                                inp.click();
                                return true;
                            }
                        }
                    }
                    return false;
                }''')
                if clicked:
                    print("  Clicked destination input via JS")
                else:
                    page.locator(
                        'input[aria-label*="Where to" i]'
                    ).first.evaluate("el => el.click()")
                    print("  Force-clicked destination input")
            page.wait_for_timeout(500)
            page.keyboard.press("Control+a")
            page.wait_for_timeout(200)
            page.keyboard.type(destination, delay=50)
            print(f'  Typed "{destination}"')
            page.wait_for_timeout(1500)
            try:
                suggestion = page.locator('ul[role="listbox"] li').first
                suggestion.wait_for(state="visible", timeout=5000)
                suggestion.evaluate("el => el.click()")
                print("  Selected destination suggestion")
            except Exception:
                page.keyboard.press("Enter")
                print("  Pressed Enter (no dropdown)")
            page.wait_for_timeout(1000)
        except Exception as e:
            print(f"  Destination input issue: {e}")

        # ── STEP 4: Set Dates ─────────────────────────────────────────────
        print(f"STEP 4: Dates — Departure: {dep_display}, Return: {ret_display}...")
        date_opened = False
        for sel in [
            '[aria-label*="Departure" i]',
            'input[placeholder*="Departure" i]',
        ]:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=2000):
                    el.evaluate("el => el.click()")
                    date_opened = True
                    print("  Opened calendar via departure field")
                    break
            except Exception:
                continue
        if not date_opened:
            print("  Could not open calendar")
        page.wait_for_timeout(1500)

        if date_opened:
            dep_month_label = departure.strftime("%B %Y")
            for _ in range(24):
                cal_text = page.evaluate('''() => {
                    const d = document.querySelector('[role="dialog"]');
                    return d ? d.innerText : '';
                }''') or ''
                if dep_month_label in cal_text:
                    break
                went = page.evaluate('''() => {
                    const d = document.querySelector('[role="dialog"]');
                    if (!d) return false;
                    const btns = d.querySelectorAll('button');
                    for (const b of btns) {
                        const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
                        if (lbl.includes('next')) { b.click(); return true; }
                    }
                    return false;
                }''')
                if not went:
                    break
                page.wait_for_timeout(400)
            print(f"  Calendar shows {dep_month_label}")
            page.wait_for_timeout(500)

            dep_day = departure.day
            dep_month_name = departure.strftime("%B")
            dep_clicked = page.evaluate(f'''() => {{
                const candidates = [];
                const btns = document.querySelectorAll('[role="button"]');
                for (const btn of btns) {{
                    const firstLine = (btn.innerText || '').split('\\\\n')[0].trim();
                    if (firstLine === '{dep_day}') {{
                        candidates.push(btn);
                    }}
                }}
                if (candidates.length === 0) return 'no_day_btn';
                for (const btn of candidates) {{
                    let el = btn.parentElement;
                    for (let i = 0; i < 6; i++) {{
                        if (!el) break;
                        if (el.getAttribute('role') === 'rowgroup') {{
                            const txt = (el.innerText || '').split('\\\\n')[0].trim();
                            if (txt === '{dep_month_name}') {{
                                btn.click();
                                return 'clicked';
                            }}
                            break;
                        }}
                        el = el.parentElement;
                    }}
                }}
                return 'no_match';
            }}''')
            if dep_clicked == 'clicked':
                print(f"  Selected departure day {dep_day}")
            else:
                print(f"  WARNING: Could not click departure day {dep_day} ({dep_clicked})")
            page.wait_for_timeout(1000)

            ret_month_label = return_date.strftime("%B %Y")
            if ret_month_label != dep_month_label:
                for _ in range(6):
                    cal_text = page.evaluate('''() => {
                        return document.body.innerText.substring(0, 5000);
                    }''') or ''
                    if ret_month_label in cal_text:
                        break
                    page.evaluate('''() => {
                        const btns = document.querySelectorAll('button');
                        for (const b of btns) {
                            const lbl = (b.getAttribute('aria-label')||'').toLowerCase();
                            if (lbl.includes('next')) { b.click(); return; }
                        }
                    }''')
                    page.wait_for_timeout(400)

            ret_day = return_date.day
            ret_month_name = return_date.strftime("%B")
            ret_clicked = page.evaluate(f'''() => {{
                const candidates = [];
                const btns = document.querySelectorAll('[role="button"]');
                for (const btn of btns) {{
                    const firstLine = (btn.innerText || '').split('\\\\n')[0].trim();
                    if (firstLine === '{ret_day}') {{
                        candidates.push(btn);
                    }}
                }}
                if (candidates.length === 0) return 'no_day_btn';
                for (const btn of candidates) {{
                    let el = btn.parentElement;
                    for (let i = 0; i < 6; i++) {{
                        if (!el) break;
                        if (el.getAttribute('role') === 'rowgroup') {{
                            const txt = (el.innerText || '').split('\\\\n')[0].trim();
                            if (txt === '{ret_month_name}') {{
                                btn.click();
                                return 'clicked';
                            }}
                            break;
                        }}
                        el = el.parentElement;
                    }}
                }}
                return 'no_match';
            }}''')
            if ret_clicked == 'clicked':
                print(f"  Selected return day {ret_day}")
            else:
                print(f"  WARNING: Could not click return day {ret_day} ({ret_clicked})")
            page.wait_for_timeout(500)

        done_result = page.evaluate('''() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const txt = (b.innerText || '').trim();
                if (txt === 'Done' && b.offsetParent !== null) {
                    b.click();
                    return 'clicked';
                }
            }
            return 'not_found';
        }''')
        print(f"  Done button: {done_result}")
        page.wait_for_timeout(1000)

        # ── STEP 5: Search ────────────────────────────────────────────────
        print("STEP 5: Searching for flights...")
        search_result = page.evaluate('''() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                const txt = (b.innerText || '').trim().toLowerCase();
                if ((txt === 'search' || aria.includes('search'))
                    && b.offsetParent !== null) {
                    b.click();
                    return 'clicked';
                }
            }
            return 'not_found';
        }''')
        print(f"  Search button: {search_result}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(8000)

        try:
            page.locator('span:has-text("$")').first.wait_for(
                state="visible", timeout=10000
            )
            print("  Results loaded (price found)")
        except Exception:
            print("  Timeout waiting for price — continuing anyway")
        page.evaluate("window.scrollBy(0, 500)")
        page.wait_for_timeout(2000)
        print(f"  URL: {page.url}")

        # ── STEP 6: Extract flights ──────────────────────────────────────
        print(f"STEP 6: Extract up to {max_results} flights...")
        seen_flights = set()

        js_flights = page.evaluate('''() => {
            const results = [];
            const candidates = document.querySelectorAll(
                'li, [role="listitem"], div[jsname], div[data-resultid]'
            );
            for (const item of candidates) {
                const text = item.innerText || '';
                if (text.length < 20 || text.length > 500) continue;
                const priceMatch = text.match(/\\$[\\d,]+/);
                if (!priceMatch) continue;
                if (!/\\d{1,2}[:\\u2236]\\d{2}/.test(text)) continue;
                // Try to find flight number (2-letter code + digits)
                const flightNumMatch = text.match(/\\b([A-Z]{2})\\s*(\\d{1,4})\\b/);
                const flightNumber = flightNumMatch
                    ? flightNumMatch[1] + ' ' + flightNumMatch[2]
                    : 'N/A';
                results.push({
                    text: text,
                    price: priceMatch[0],
                    flightNumber: flightNumber,
                });
                if (results.length >= 20) break;
            }
            return results;
        }''')
        print(f"  JS found {len(js_flights)} candidate flight items")

        for item in js_flights:
            if len(results) >= max_results:
                break
            card_text = item['text']
            price = item['price']
            flight_number = item.get('flightNumber', 'N/A')
            lines = [l.strip() for l in card_text.split('\\n') if l.strip()]
            itinerary_parts = []
            for line in lines:
                if re.match(r'^\\$[\\d,]+', line):
                    continue
                if line.lower() in (
                    'round trip', 'economy', 'selected', 'select',
                    'price unavailable', 'nonstop',
                ):
                    continue
                if any(kw in line.lower() for kw in (
                    'top departing', 'ranked based', 'sorted by',
                    'passenger assistance', 'taxes + fees',
                    'optional charges', 'bag fees',
                )):
                    continue
                if re.search(r'kg CO2|% emissions', line):
                    continue
                if re.match(r'^[A-Z]{3}[\\u2013\\-\\u2013][A-Z]{3}$', line):
                    continue
                if len(line) < 3:
                    continue
                itinerary_parts.append(line)
            itinerary = " | ".join(itinerary_parts[:6])
            if not itinerary:
                continue
            flight_key = f"{flight_number}_{itinerary}_{price}".lower().strip()
            if flight_key in seen_flights:
                continue
            seen_flights.add(flight_key)
            results.append({
                "flightNumber": flight_number,
                "itinerary": itinerary,
                "price": price,
            })

        # Fallback: text-based extraction
        if not results:
            print("  Structured extraction missed — text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            lines = body_text.split('\\n')
            buf = []
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                pm = re.search(r'\\$[\\d,]+', line)
                if pm:
                    if buf:
                        itinerary = " | ".join(buf[-5:])
                        price = pm.group(0)
                        fk = f"{itinerary}_{price}".lower()
                        if fk not in seen_flights:
                            seen_flights.add(fk)
                            results.append({
                                "flightNumber": "N/A",
                                "itinerary": itinerary,
                                "price": price,
                            })
                            if len(results) >= max_results:
                                break
                    buf = []
                else:
                    buf.append(line)

        # ── Print results ─────────────────────────────────────────────────
        print(f"\\nFound {len(results)} flights ({origin} → {destination}):")
        print(f"  Departure: {dep_display}  Return: {ret_display}\\n")
        for i, flight in enumerate(results, 1):
            print(f"  {i}. Flight: {flight['flightNumber']}")
            print(f"     {flight['itinerary']}")
            print(f"     Price: {flight['price']} (Economy)")

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:

            browser.close()

        except Exception:

            pass

        chrome_proc.terminate()

        shutil.rmtree(profile_dir, ignore_errors=True)

    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"\\nTotal flights found: {len(items)}")
`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Google Flights – Round Trip Flight Search (v2)");
  console.log("  Steps 1-5: Deterministic | Step 6: AI exploration");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  ✈️  ${CFG.origin} → ${CFG.destination}`);
  console.log(`  📅 Departure: ${CFG.departureDisplay}  Return: ${CFG.returnDisplay}\n`);

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");
  let stagehand;

  try {
    console.log("🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      llmClient,
      localBrowserLaunchOptions: {
        userDataDir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
        headless: false,
        viewport: { width: 1920, height: 1080 },
        args: ["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions", "--start-maximized", "--window-size=1920,1080"],
      },
    });
    await stagehand.init();
    console.log("✅ Stagehand ready\n");

    const page = stagehand.context.pages()[0];

    // Navigate
    console.log("🌐 Loading Google Flights...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    console.log("✅ Loaded\n");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);

    // Steps 1-5: Deterministic Playwright (no AI calls)
    await dismissPopups(page);
    await ensureRoundTrip(page, recorder);
    await setOrigin(page, recorder, CFG.origin);
    await setDestination(page, recorder, CFG.destination);
    await setDates(page, recorder);
    await clickSearch(page, recorder);

    // Step 6: AI-driven exploration
    const listings = await extractFlightsAI(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${listings.flights.length} flights found`);
    console.log("═══════════════════════════════════════════════════════════");
    listings.flights.forEach((f, i) => {
      console.log(`  ${i + 1}. ✈️  ${f.flightNumber} — ${f.itinerary} — ${f.price}`);
    });

    // Save Python + JSON
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "flights_search2.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python: ${pyPath}`);

    const jsonPath = path.join(__dirname, "recorded_actions2.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions: ${jsonPath}`);

    return listings;

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder);
      fs.writeFileSync(path.join(__dirname, "flights_search2.py"), pyScript, "utf-8");
      console.log("⚠️  Partial Python saved");
    }
    throw err;
  } finally {
    if (stagehand) {
      console.log("🧹 Closing...");
      await stagehand.close();
    }
  }
}

if (require.main === module) {
  main().then(() => { console.log("🎊 Done!"); process.exit(0); }).catch((e) => { console.error("💥", e.message); process.exit(1); });
}
module.exports = { main };
