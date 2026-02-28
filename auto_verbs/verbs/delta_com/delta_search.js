const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Delta Air Lines – Round Trip Flight Search
 *
 * Uses page.evaluate() for DOM traversal + page.click(x,y) & page.type()
 * for form filling, then stagehand.extract() for results.
 *
 * Stagehand Page API:
 *   page.evaluate(expr, arg)       — run JS in browser
 *   page.click(x, y)               — click at screen coordinates
 *   page.type(text, {delay})       — type text into focused element
 *   page.keyPress("Control+a")     — key combo
 *   page.goto(url), page.url(), page.waitForTimeout(ms), page.waitForLoadState()
 */

// ── Date Computation ─────────────────────────────────────────────────────────
function computeDates() {
  const today = new Date();
  const dep = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const ret = new Date(dep); ret.setDate(ret.getDate() + 4);
  const fmt = (d) => `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
  return { departure: fmt(dep), ret: fmt(ret) };
}
const dates = computeDates();

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.delta.com",
  from: "Seattle",
  to: "Chicago",
  depDate: dates.departure,
  retDate: dates.ret,
  maxResults: 5,
  waits: { page: 5000, type: 2000, select: 1500, search: 12000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
// The concretized Python file (delta_search.py) contains deeply nested JS code
// inside page.evaluate(r'''...''') blocks that would be an escaping nightmare
// to embed in a JS template literal. Instead, we read the Python file from disk
// and apply cfg-based substitutions for the parameterized default values.
function genPython(cfg, recorder) {
  const pyPath = path.join(__dirname, "delta_search.py");
  if (fs.existsSync(pyPath)) {
    let content = fs.readFileSync(pyPath, "utf-8");
    // Update default parameter values from cfg
    content = content.replace(
      /origin:\s*str\s*=\s*"[^"]*"/,
      `origin: str = "${cfg.from}"`
    );
    content = content.replace(
      /destination:\s*str\s*=\s*"[^"]*"/,
      `destination: str = "${cfg.to}"`
    );
    content = content.replace(
      /max_results:\s*int\s*=\s*\d+/,
      `max_results: int = ${cfg.maxResults}`
    );
    content = content.replace(
      /page\.goto\("https:\/\/www\.\w+\.com[^"]*"\)/,
      `page.goto("${cfg.url}")`
    );
    return content;
  }
  // Fallback if .py doesn't exist yet — minimal placeholder
  console.warn("⚠️  delta_search.py not found on disk; writing placeholder.");
  return `"""
Delta Air Lines – Round Trip Flight Search
Python file not found. Create delta_search.py with the concretized version first.
"""\n`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(stagehand, page) {
  console.log("🔲 Dismissing popups...");
  await page.waitForTimeout(2000);

  // DOM-based dismiss
  for (const strategy of [
    `(() => {
      const btns = document.querySelectorAll('button, a');
      for (const btn of btns) {
        const txt = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase().trim();
        if (['no thanks', 'no, thanks', 'close', 'dismiss', 'accept', 'got it', 'accept all', 'i understand'].includes(txt)) {
          if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
            btn.click(); return true;
          }
        }
      }
      return false;
    })()`,
    `(() => {
      const btns = document.querySelectorAll('[aria-label="Close"], [aria-label="close"], [data-dismiss="modal"]');
      for (const btn of btns) {
        if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
          btn.click(); return true;
        }
      }
      return false;
    })()`,
  ]) {
    try {
      const clicked = await page.evaluate(strategy);
      if (clicked) console.log("   ✅ Dismissed a popup (DOM)");
      await page.waitForTimeout(500);
    } catch (e) { /* no popup */ }
  }
  await page.waitForTimeout(1000);
}

async function selectBookTab(stagehand, page, recorder) {
  console.log("🎯 STEP 0: Ensure we are on the 'Book' flight search form...");

  // Delta.com may default to check-in or other tabs. Find and click "Book" tab.
  const bookClicked = await page.evaluate(`(() => {
    // Look for "Book" tab/link near top of page
    const candidates = document.querySelectorAll('a, button, span, li, [role="tab"]');
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (text.toLowerCase() === 'book' || text.toLowerCase() === 'book a trip') {
        const r = el.getBoundingClientRect();
        if (r.y < 400 && r.width > 20 && (el.offsetParent !== null || el.getClientRects().length > 0)) {
          el.click();
          return { clicked: true, text: text };
        }
      }
    }
    return { clicked: false };
  })()`);

  if (bookClicked.clicked) {
    console.log(`   ✅ Clicked "${bookClicked.text}" tab`);
    recorder.record("act", { instruction: "Select Book tab", description: "Clicked Book tab" });
  } else {
    console.log("   ⚠️ Book tab not found via DOM — trying AI...");
    try {
      await stagehand.act("Click on the 'Book' tab at the top of the page to show the flight booking form (not Check-In, not My Trips)");
      console.log("   ✅ Clicked Book tab via AI");
    } catch (e) {
      console.log("   ⚠️ Assuming Book form is already visible");
    }
  }
  await page.waitForTimeout(2000);

  // Also ensure "Flights" is selected (not Hotels, Cars, etc.)
  const flightTabResult = await page.evaluate(`(() => {
    const candidates = document.querySelectorAll('a, button, span, li, label, [role="tab"]');
    for (const el of candidates) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text === 'flights' || text === 'flight') {
        const r = el.getBoundingClientRect();
        if (r.y < 400 && (el.offsetParent !== null || el.getClientRects().length > 0)) {
          el.click();
          return 'clicked';
        }
      }
    }
    return 'not_found';
  })()`);
  if (flightTabResult === 'clicked') {
    console.log("   ✅ Ensured 'Flights' sub-tab selected");
  }
  await page.waitForTimeout(1000);
}

async function ensureRoundTrip(stagehand, page, recorder) {
  console.log("🎯 STEP 1: Ensuring Round Trip...");
  try {
    // Check what's currently selected
    const tripText = await page.evaluate(`(() => {
      const selects = document.querySelectorAll('select');
      for (const s of selects) {
        const id = (s.id || s.name || '').toLowerCase();
        if (id.includes('trip')) {
          return (s.options[s.selectedIndex]?.text || '').trim().toLowerCase();
        }
      }
      // Check all visible text for "round trip" near the top of the booking widget
      const els = document.querySelectorAll('button, a, span, label, [role="tab"], select, li');
      for (const el of els) {
        const t = (el.textContent || '').trim().toLowerCase();
        const r = el.getBoundingClientRect();
        if (r.y < 350 && (t === 'round trip' || t === 'roundtrip')) {
          const sel = el.getAttribute('aria-selected') || el.getAttribute('aria-current') || el.classList?.contains('active') ? 'selected' : '';
          return t + (sel ? ' (active)' : '');
        }
      }
      return '';
    })()`);

    if (tripText.includes('round trip')) {
      console.log(`   ✅ Already Round Trip ("${tripText}")`);
      recorder.record("act", { instruction: "Ensure Round Trip", description: "Round Trip already selected" });
    } else {
      // Use AI to select round trip
      await stagehand.act("Select 'Round Trip' as the trip type in the flight booking form");
      console.log("   ✅ Selected Round Trip via AI");
      recorder.record("act", { instruction: "Ensure Round Trip", description: "AI selected Round Trip" });
    }
  } catch (e) {
    console.log(`   ⚠️  ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(500);
}

async function fillOrigin(stagehand, page, recorder, city) {
  console.log(`🎯 STEP 2: Origin = "${city}"...`);
  try {
    // Click the "From" field — this opens the airport modal
    const fromField = await page.evaluate(`(() => {
      const el = document.querySelector('#fromAirportName') ||
                 document.querySelector('a[id*="from" i]') ||
                 document.querySelector('[aria-label*="From" i]');
      if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2, id: el.id, tag: el.tagName };
      }
      return null;
    })()`);

    if (fromField) {
      await page.click(fromField.x, fromField.y);
      console.log(`   ✅ Clicked From field (${fromField.tag} #${fromField.id})`);
    } else {
      await stagehand.act("Click on the departure city / 'From' field in the booking form");
      console.log("   ✅ Clicked From field via AI");
    }
    await page.waitForTimeout(2000);

    // Find and click the search input INSIDE the modal (not departureDate!)
    const modalInput = await page.evaluate(`(() => {
      const modals = document.querySelectorAll('ngc-airport-lookup-modal, modal-container, [class*="modal-body"], [class*="modal-content"]');
      for (const modal of modals) {
        if (!(modal.offsetParent !== null || modal.getClientRects().length > 0)) continue;
        const inputs = modal.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), input[placeholder]');
        for (const inp of inputs) {
          if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
          const id = (inp.id || '').toLowerCase();
          // Skip date fields, confirmation fields, etc.
          if (id.includes('date') || id.includes('return') || id.includes('depart') || id.includes('confirmation') || id.includes('promo')) continue;
          const r = inp.getBoundingClientRect();
          if (r.width > 50 && r.height > 15) {
            return { x: r.x + r.width/2, y: r.y + r.height/2, id: inp.id, placeholder: inp.placeholder };
          }
        }
      }
      return null;
    })()`);

    if (modalInput) {
      await page.click(modalInput.x, modalInput.y);
      console.log(`   ✅ Focused modal search input (id=${modalInput.id}, placeholder=${modalInput.placeholder})`);
      await page.waitForTimeout(300);
    } else {
      console.log("   ⚠️ Could not find modal search input — typing into focused element");
    }

    await page.keyPress("Ctrl+a");
    await page.type(city, { delay: 70 });
    console.log(`   ✅ Typed "${city}"`);
    recorder.record("act", { instruction: `Fill origin: ${city}`, description: `Typed ${city}` });
    await page.waitForTimeout(3000);

    // DOM-based suggestion selection (concretized — avoids AI API call)
    const originSuggestion = await page.evaluate(`(() => {
      const containers = document.querySelectorAll(
        'ngc-airport-lookup-modal, modal-container, [class*="modal"], [class*="airport-list"], [class*="suggestion"], ul, ol'
      );
      for (const container of containers) {
        if (!(container.offsetParent !== null || container.getClientRects().length > 0)) continue;
        const items = container.querySelectorAll('li, a, [role="option"], [class*="airport"], [class*="city"], button');
        for (const item of items) {
          const text = (item.textContent || '').trim();
          if (text.length < 3 || text.length > 200) continue;
          if (!/\\bSEA\\b/.test(text) && !/Seattle/i.test(text)) continue;
          const lower = text.toLowerCase();
          if (lower === 'search' || lower === 'close' || lower === 'clear') continue;
          const r = item.getBoundingClientRect();
          if (r.width > 30 && r.height > 15 && r.y > 0 && r.y < window.innerHeight) {
            return { x: r.x + r.width/2, y: r.y + r.height/2, text: text.substring(0, 80) };
          }
        }
      }
      return null;
    })()`);

    if (originSuggestion) {
      await page.click(originSuggestion.x, originSuggestion.y);
      console.log(`   ✅ Selected origin (DOM): ${originSuggestion.text}`);
    } else {
      // Fall back to AI only if DOM scan missed
      await stagehand.act(`In the airport search results list, click on the first result that contains "SEA" or "Seattle". Do NOT click "SEARCH", "Close", or "Clear" buttons.`);
      console.log(`   ✅ Selected origin via AI (fallback)`);
    }
    recorder.record("act", { instruction: "Select origin", description: `SEA Seattle` });
  } catch (e) {
    console.log(`   ⚠️ Origin error: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(CFG.waits.select);
}

async function fillDestination(stagehand, page, recorder, city) {
  console.log(`🎯 STEP 3: Destination = "${city}"...`);
  try {
    // Click the "To" field
    const toField = await page.evaluate(`(() => {
      const el = document.querySelector('#toAirportName') ||
                 document.querySelector('a[id*="toAirport" i]') ||
                 document.querySelector('[aria-label*="To" i]');
      if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2, id: el.id, tag: el.tagName };
      }
      return null;
    })()`);

    if (toField) {
      await page.click(toField.x, toField.y);
      console.log(`   ✅ Clicked To field (${toField.tag} #${toField.id})`);
    } else {
      await stagehand.act("Click on the arrival city / 'To' destination field in the booking form");
      console.log("   ✅ Clicked To field via AI");
    }
    await page.waitForTimeout(2000);

    // Find and click the search input INSIDE the modal (not date/confirmation fields!)
    const modalInput = await page.evaluate(`(() => {
      const modals = document.querySelectorAll('ngc-airport-lookup-modal, modal-container, [class*="modal-body"], [class*="modal-content"]');
      for (const modal of modals) {
        if (!(modal.offsetParent !== null || modal.getClientRects().length > 0)) continue;
        const inputs = modal.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), input[placeholder]');
        for (const inp of inputs) {
          if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
          const id = (inp.id || '').toLowerCase();
          if (id.includes('date') || id.includes('return') || id.includes('depart') || id.includes('confirmation') || id.includes('promo')) continue;
          const r = inp.getBoundingClientRect();
          if (r.width > 50 && r.height > 15) {
            return { x: r.x + r.width/2, y: r.y + r.height/2, id: inp.id, placeholder: inp.placeholder };
          }
        }
      }
      return null;
    })()`);

    if (modalInput) {
      await page.click(modalInput.x, modalInput.y);
      console.log(`   ✅ Focused modal search input (id=${modalInput.id}, placeholder=${modalInput.placeholder})`);
      await page.waitForTimeout(300);
    } else {
      console.log("   ⚠️ Could not find modal search input — typing into focused element");
    }

    await page.keyPress("Ctrl+a");
    await page.type(city, { delay: 70 });
    console.log(`   ✅ Typed "${city}"`);
    recorder.record("act", { instruction: `Fill destination: ${city}`, description: `Typed ${city}` });
    await page.waitForTimeout(3000);

    // DOM-based suggestion selection (concretized — avoids AI API call)
    const destSuggestion = await page.evaluate(`(() => {
      const containers = document.querySelectorAll(
        'ngc-airport-lookup-modal, modal-container, [class*="modal"], [class*="airport-list"], [class*="suggestion"], ul, ol'
      );
      for (const container of containers) {
        if (!(container.offsetParent !== null || container.getClientRects().length > 0)) continue;
        const items = container.querySelectorAll('li, a, [role="option"], [class*="airport"], [class*="city"], button');
        for (const item of items) {
          const text = (item.textContent || '').trim();
          if (text.length < 3 || text.length > 200) continue;
          if (!/\\bCHI\\b/.test(text) && !/Chicago/i.test(text) && !/\\bORD\\b/.test(text)) continue;
          const lower = text.toLowerCase();
          if (lower === 'search' || lower === 'close' || lower === 'clear') continue;
          const r = item.getBoundingClientRect();
          if (r.width > 30 && r.height > 15 && r.y > 0 && r.y < window.innerHeight) {
            return { x: r.x + r.width/2, y: r.y + r.height/2, text: text.substring(0, 80) };
          }
        }
      }
      return null;
    })()`);

    if (destSuggestion) {
      await page.click(destSuggestion.x, destSuggestion.y);
      console.log(`   ✅ Selected destination (DOM): ${destSuggestion.text}`);
    } else {
      // Fall back to AI only if DOM scan missed
      await stagehand.act(`In the airport search results list, click on the first result that contains "CHI" or "Chicago" or "ORD". Do NOT click "SEARCH", "Close", or "Clear" buttons.`);
      console.log(`   ✅ Selected destination via AI (fallback)`);
    }
    recorder.record("act", { instruction: "Select destination", description: `CHI Chicago` });
  } catch (e) {
    console.log(`   ⚠️ Destination error: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(CFG.waits.select);
}

async function fillDates(stagehand, page, recorder, depDate, retDate) {
  console.log(`🎯 STEP 4: Dates — Dep: ${depDate}, Ret: ${retDate}...`);

  const [depM, depD, depY] = depDate.split("/").map(Number);
  const [retM, retD, retY] = retDate.split("/").map(Number);
  const depDateObj = new Date(depY, depM - 1, depD);
  const retDateObj = new Date(retY, retM - 1, retD);
  const depMonthName = depDateObj.toLocaleString("en-US", { month: "long" });
  const retMonthName = retDateObj.toLocaleString("en-US", { month: "long" });

  // ── Helper: read the currently displayed month from the calendar DOM ──
  async function readCalendarMonth() {
    return await page.evaluate(`(() => {
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const re = new RegExp('\\\\b(' + months.join('|') + ')\\\\s+(\\\\d{4})\\\\b', 'i');
      // Strategy 1: scan text nodes inside small visible elements (calendar headers)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim();
        if (text.length < 4 || text.length > 30) continue;
        const match = text.match(re);
        if (match) {
          const el = walker.currentNode.parentElement;
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.width > 0 && r.y > 0 && r.y < window.innerHeight) {
              return match[0];
            }
          }
        }
      }
      // Strategy 2: check aria-label attributes
      const ariaEls = document.querySelectorAll('[aria-label]');
      for (const el of ariaEls) {
        const label = el.getAttribute('aria-label') || '';
        const match = label.match(re);
        if (match) {
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.width > 0 && r.y > 0) return match[0];
        }
      }
      return '';
    })()`);
  }

  // ── Helper: click the next-month arrow in the calendar ──
  async function clickNextMonth() {
    const arrow = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button, a, [role="button"], span[class*="icon"]');
      for (const btn of btns) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        const text = (btn.textContent || '').trim();
        const cls = (btn.className || '').toLowerCase();
        if (aria.includes('next') || aria.includes('forward') ||
            title.includes('next') || title.includes('forward') ||
            cls.includes('next') || cls.includes('forward') || cls.includes('right-arrow') ||
            text === '›' || text === '>' || text === '→' || text === '»') {
          const r = btn.getBoundingClientRect();
          if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < window.innerHeight) {
            return { x: r.x + r.width/2, y: r.y + r.height/2, desc: (aria || text || cls).substring(0, 40) };
          }
        }
      }
      return null;
    })()`);
    if (arrow) {
      await page.click(arrow.x, arrow.y);
      console.log(`   ➡️ Clicked next arrow (${arrow.desc})`);
      return true;
    }
    return false;
  }

  // ── Helper: click a specific day in the visible calendar ──
  async function clickDay(dayNum, monthName, year) {
    const dayCell = await page.evaluate(`((d, m, y) => {
      // Strategy 1: aria-label containing full date (e.g. "27 April 2026", "April 27, 2026")
      const patterns = [
        d + ' ' + m + ' ' + y,
        m + ' ' + d + ', ' + y,
        m + ' ' + d + ' ' + y,
      ];
      const allEls = document.querySelectorAll('[aria-label], td, button, a, [role="gridcell"]');
      for (const el of allEls) {
        const aria = (el.getAttribute('aria-label') || '');
        const lower = aria.toLowerCase();
        for (const pat of patterns) {
          if (lower.includes(pat.toLowerCase())) {
            const r = el.getBoundingClientRect();
            if (r.width > 10 && r.height > 10 && r.y > 0 && r.y < window.innerHeight) {
              return { x: r.x + r.width/2, y: r.y + r.height/2, method: 'aria-label', label: aria.substring(0, 60) };
            }
          }
        }
      }
      // Strategy 2: find calendar day cells by exact number text
      const cells = document.querySelectorAll('td, button, a, [role="gridcell"], span, div');
      const candidates = [];
      for (const cell of cells) {
        // Get direct text content (exclude child element text for precision)
        let directText = '';
        for (const node of cell.childNodes) {
          if (node.nodeType === 3) directText += node.textContent;
        }
        directText = directText.trim();
        const fullText = (cell.textContent || '').trim();
        if (directText !== String(d) && fullText !== String(d)) continue;
        const r = cell.getBoundingClientRect();
        // Calendar cells are typically 25-80px, visible on screen, below the header
        if (r.width >= 15 && r.height >= 15 && r.width <= 100 && r.height <= 100 && r.y > 100 && r.y < window.innerHeight) {
          candidates.push({
            x: r.x + r.width/2, y: r.y + r.height/2,
            method: 'text-match',
            area: r.width * r.height,
            tag: cell.tagName,
            cls: (cell.className || '').substring(0, 50)
          });
        }
      }
      // Prefer larger cells (more likely calendar cells, not random text)
      candidates.sort((a, b) => b.area - a.area);
      return candidates[0] || null;
    })(${dayNum}, "${monthName}", ${year})`);

    if (dayCell) {
      await page.click(dayCell.x, dayCell.y);
      console.log(`   ✅ Clicked day ${dayNum} (${dayCell.method}: ${dayCell.label || dayCell.cls || dayCell.tag})`);
      return true;
    }
    return false;
  }

  try {
    // ── Open the calendar ──
    const calTrigger = await page.evaluate(`(() => {
      const selectors = [
        '#calDepartLabelCont',
        '#input_departureDate_1',
        '[id*="depart" i][id*="date" i]',
        '[aria-label*="Depart" i]',
        '[class*="calendar" i]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2, id: el.id || sel };
        }
      }
      return null;
    })()`);

    if (calTrigger) {
      await page.click(calTrigger.x, calTrigger.y);
      console.log(`   ✅ Opened calendar (${calTrigger.id})`);
    } else {
      await stagehand.act("Click on the departure date field or calendar in the booking form");
      console.log("   ✅ Opened calendar via AI");
    }
    await page.waitForTimeout(2000);

    // ── Navigate to departure month (DOM-based with AI fallback) ──
    for (let attempt = 0; attempt < 12; attempt++) {
      const displayedMonth = await readCalendarMonth();
      console.log(`   📅 Calendar shows: "${displayedMonth}" (need: "${depMonthName} ${depY}")`);

      if (displayedMonth && displayedMonth.toLowerCase().includes(depMonthName.toLowerCase()) &&
          displayedMonth.includes(String(depY))) {
        console.log("   ✅ Correct month displayed");
        break;
      }

      // Try DOM arrow first, fall back to AI
      const arrowClicked = await clickNextMonth();
      if (!arrowClicked) {
        console.log("   ⚠️ Next arrow not found via DOM — using AI fallback");
        await stagehand.act("Click the forward/next month arrow button in the calendar to go to the next month.");
        console.log("   ➡️ Advanced to next month (AI)");
      }
      await page.waitForTimeout(800);
    }

    // ── Click departure day (DOM-based with AI fallback) ──
    const depClicked = await clickDay(depD, depMonthName, depY);
    if (!depClicked) {
      console.log("   ⚠️ Day not found via DOM — using AI fallback");
      await stagehand.act(`In the calendar showing ${depMonthName} ${depY}, click on day number ${depD} to select it as the departure date.`);
    }
    console.log(`   ✅ Selected departure: ${depMonthName} ${depD}, ${depY}`);
    recorder.record("act", { instruction: `Select departure: ${depDate}`, description: "Selected departure" });
    await page.waitForTimeout(1500);

    // ── Navigate to return month if different ──
    if (retM !== depM || retY !== depY) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const displayedMonth = await readCalendarMonth();
        if (displayedMonth && displayedMonth.toLowerCase().includes(retMonthName.toLowerCase()) &&
            displayedMonth.includes(String(retY))) break;

        const arrowClicked = await clickNextMonth();
        if (!arrowClicked) {
          await stagehand.act("Click the forward/next month arrow button in the calendar to go to the next month.");
        }
        await page.waitForTimeout(800);
      }
    }

    // ── Click return day (DOM-based with AI fallback) ──
    const retClicked = await clickDay(retD, retMonthName, retY);
    if (!retClicked) {
      console.log("   ⚠️ Day not found via DOM — using AI fallback");
      await stagehand.act(`In the calendar showing ${retMonthName} ${retY}, click on day number ${retD} to select it as the return date.`);
    }
    console.log(`   ✅ Selected return: ${retMonthName} ${retD}, ${retY}`);
    recorder.record("act", { instruction: `Select return: ${retDate}`, description: "Selected return" });
    await page.waitForTimeout(1000);

    // ── Close calendar — click Done button (DOM-based) ──
    const doneBtnCoords = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const txt = (btn.textContent || '').trim().toLowerCase();
        if ((txt === 'done' || txt === 'apply' || txt === 'close') && (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
          const r = btn.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2, text: txt };
        }
      }
      return null;
    })()`);

    if (doneBtnCoords) {
      await page.click(doneBtnCoords.x, doneBtnCoords.y);
      console.log(`   ✅ Closed calendar (${doneBtnCoords.text})`);
    } else {
      try {
        await stagehand.act("Click the Done button to close the calendar");
        console.log("   ✅ Closed calendar via AI");
      } catch (e) {
        await page.keyPress("Escape");
        console.log("   ✅ Closed calendar (Escape)");
      }
    }
  } catch (e) {
    console.log(`   ⚠️ Date error: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(500);
}

async function clickSearch(stagehand, page, recorder) {
  console.log("🎯 STEP 5: Search flights...");

  try {
    // DOM-based search button click (concretized — avoids AI API call)
    const searchBtn = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button, input[type="submit"]');
      for (const btn of btns) {
        const txt = (btn.textContent || btn.value || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const id = (btn.id || '').toLowerCase();
        if ((txt.includes('submit') || txt.includes('search') || aria.includes('search') || id.includes('submit') || id.includes('search')) &&
            !txt.includes('clear') && !txt.includes('reset') &&
            (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
          const r = btn.getBoundingClientRect();
          if (r.width > 30 && r.height > 20) {
            return { x: r.x + r.width/2, y: r.y + r.height/2, text: txt.substring(0, 40), id: btn.id };
          }
        }
      }
      return null;
    })()`);

    if (searchBtn) {
      await page.click(searchBtn.x, searchBtn.y);
      console.log(`   ✅ Clicked search button (DOM): "${searchBtn.text}" #${searchBtn.id}`);
    } else {
      // Fall back to AI observe+act
      console.log("   ⚠️ Search button not found via DOM — using AI fallback");
      const actions = await stagehand.observe("Find the Submit or Search button to search for flights");
      if (actions.length > 0) {
        await stagehand.act(actions[0]);
      } else {
        await stagehand.act("Click the Submit or Search button to search for flights");
      }
      console.log("   ✅ Clicked search (AI fallback)");
    }
    recorder.record("act", { instruction: "Click Search/Submit", description: "Click Search" });
  } catch (e) {
    console.log(`   ⚠️  Search click error: ${e.message.split("\n")[0]}`);
  }

  console.log("⏳ Waiting for results...");
  await page.waitForTimeout(5000);
  let currentUrl = page.url();
  console.log(`   📍 URL: ${currentUrl}`);

  // Wait for page load if we navigated
  if (currentUrl !== CFG.url && currentUrl !== CFG.url + '/') {
    try {
      await page.waitForLoadState("networkidle");
    } catch { /* ignore */ }
    await page.waitForTimeout(8000);
  } else {
    // Wait longer — maybe it's a SPA route change or loading results on same page
    console.log("   ⏳ Waiting for SPA navigation or results...");
    await page.waitForTimeout(15000);
    currentUrl = page.url();
    console.log(`   📍 URL after wait: ${currentUrl}`);
  }

  recorder.wait(CFG.waits.search, "Wait for results");
}

async function extractResults(stagehand, page, recorder) {
  console.log(`🎯 STEP 6: Extract up to ${CFG.maxResults} flights...\n`);
  const { z } = require("zod/v3");

  const currentUrl = page.url();
  console.log(`   📍 URL: ${currentUrl}`);

  // If still on homepage, search didn't work
  if (currentUrl === CFG.url || currentUrl === CFG.url + '/') {
    console.log("   ❌ Still on homepage — search may not have worked");
    return { flights: [] };
  }

  // Wait longer for Delta's API-driven results to load
  console.log("   ⏳ Waiting for flight results to load...");
  for (let i = 0; i < 15; i++) {
    const hasFlightData = await page.evaluate(`(() => {
      const body = document.body.innerText || '';
      // Check for typical Delta results page elements
      return body.includes('Nonstop') || body.includes('1 stop') || body.includes('2 stops') ||
             /\\$\\d{2,}/.test(body) || body.includes('Best Flights') || body.includes('Lowest Fare') ||
             body.includes('departure') || body.includes('Select') ||
             document.querySelectorAll('[class*="flight-card"], [class*="flightCard"], [class*="result-card"]').length > 0;
    })()`);
    if (hasFlightData) {
      console.log(`   ✅ Flight data detected on page (after ${(i+1)}s wait)`);
      break;
    }
    if (i === 14) {
      console.log("   ⚠️ No flight data detected after 15s — trying extraction anyway...");
    }
    await page.waitForTimeout(1000);
  }

  // Scroll down multiple times to trigger lazy-loading of additional results
  for (let scroll = 0; scroll < 5; scroll++) {
    await page.evaluate("window.scrollBy(0, 500)");
    await page.waitForTimeout(800);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // Try DOM-based extraction first — more reliable than AI for structured data
  const domFlights = await page.evaluate(`((maxResults) => {
    const flights = [];
    const seen = new Set();
    
    // Try selectors in order of SPECIFICITY (most specific first) to avoid matching containers
    // Learned: Delta uses '.mach-flight-card' Angular component for each flight card
    const cardSelectors = [
      '.mach-flight-card',                                          // Delta Angular flight card component (confirmed)
      '[class*="mach-flight-card"]',                                // Broader match for the same component
      '.flight-results-grid__flight-card',                          // Delta grid card wrapper
      '[class*="flight-results-grid__flight-card"]',
      '[class*="flightCard"]:not([class*="flight-cards"])',         // Singular card, not container
      '[data-testid*="flight"]',
      '[class*="flight-listing"]', '[class*="flightListing"]',
      '[class*="bound"]', '[class*="slice"]',
      'li[class*="result"]', 'div[class*="result"]',
      '[class*="card-body"]',
      '[class*="flight-card"]',                                     // Broadest — last resort
    ];
    
    let cards = [];
    let usedSelector = '';
    // Pick the FIRST selector that yields a reasonable number (1-50) of results
    for (const sel of cardSelectors) {
      try {
        const c = document.querySelectorAll(sel);
        if (c.length >= 1 && c.length <= 50) {
          cards = c;
          usedSelector = sel;
          break;
        }
      } catch (e) { /* invalid selector */ }
    }
    // If nothing in range, try any that has results
    if (cards.length === 0) {
      for (const sel of cardSelectors) {
        try {
          const c = document.querySelectorAll(sel);
          if (c.length > 0) { cards = c; usedSelector = sel; break; }
        } catch (e) {}
      }
    }
    
    // Debug info
    const cardInfo = { selectorUsed: usedSelector, cardCount: cards.length, sampleClasses: [] };
    
    if (cards.length > 0) {
      cardInfo.sampleClasses = Array.from(cards).slice(0, 3).map(c => c.className.substring(0, 80));
      
      for (const card of Array.from(cards).slice(0, maxResults * 2)) {
        const text = (card.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text.length < 10) continue;
        
        // Extract prices
        const priceMatch = text.match(/\\$\\d{1,5}/);
        const price = priceMatch ? priceMatch[0] : 'N/A';
        // Extract times (pattern like 8:00 AM or 8:00am)
        const timeMatches = text.match(/\\d{1,2}:\\d{2}\\s*[AaPp][Mm]/g) || [];
        const depTime = timeMatches[0] || '';
        const arrTime = timeMatches[1] || '';
        // Extract stops
        const stopsMatch = text.match(/(Nonstop|Non-stop|\\d+\\s*stop[s]?)/i);
        const stops = stopsMatch ? stopsMatch[0] : '';
        // Extract duration (pattern like 4h 8m)
        const durMatch = text.match(/(\\d+h\\s*\\d*m?|\\d+\\s*hr\\s*\\d*\\s*min)/i);
        const duration = durMatch ? durMatch[0] : '';
        // Extract flight number if visible (e.g. DL 1234)        
        const flightMatch = text.match(/(?:DL|Delta)\\s*\\d{1,4}/i);
        const flightNum = flightMatch ? flightMatch[0] : '';

        const itinerary = [depTime, arrTime, stops, duration, flightNum].filter(Boolean).join(' | ') || text.substring(0, 120);
        
        // Deduplicate by core itinerary
        const key = depTime + '|' + arrTime + '|' + stops + '|' + price;
        if (seen.has(key) && key !== '|||N/A') continue;
        seen.add(key);
        
        if (price !== 'N/A' || depTime) {
          flights.push({ itinerary, economyPrice: price });
        }
        if (flights.length >= maxResults) break;
      }
    }
    
    // Fallback: scan for price patterns in the page text
    const body = document.body.innerText || '';
    const priceMatches = body.match(/\\$\\d{2,5}/g) || [];
    
    return { 
      flights, 
      priceSample: priceMatches.slice(0, 8), 
      bodyLength: body.length, 
      bodySnippet: flights.length === 0 ? body.substring(0, 500) : '',
      cardInfo
    };
  })(${CFG.maxResults})`);

  console.log(`   📊 DOM extraction: ${domFlights.flights.length} flights`);
  if (domFlights.cardInfo) {
    console.log(`   🔍 Card selector: "${domFlights.cardInfo.selectorUsed}" (${domFlights.cardInfo.cardCount} cards)`);
    domFlights.cardInfo.sampleClasses.forEach(c => console.log(`      class: "${c}"`));
  }
  if (domFlights.priceSample && domFlights.priceSample.length > 0) {
    console.log(`   💲 Found prices on page: ${domFlights.priceSample.join(', ')}`);
  }
  if (domFlights.bodySnippet) {
    console.log(`   📝 Page start: ${domFlights.bodySnippet.substring(0, 200)}...`);
  }

  let listings;
  if (domFlights.flights.length > 0) {
    listings = { flights: domFlights.flights };
  } else {
    // Fallback to AI extraction
    console.log("   🤖 Trying AI extraction...");
    listings = await stagehand.extract(
      `Extract up to ${CFG.maxResults} departure flight results from this Delta Air Lines search results page.
For each flight get:
1. The full itinerary: departure time, arrival time, number of stops, total duration, and route
2. The economy class price (the lowest displayed price like "$199")
Only extract real flight results, not ads or headers. If no flights are visible, return an empty array.`,
      z.object({
        flights: z.array(z.object({
          itinerary: z.string().describe("Full itinerary: departure time - arrival time, stops, duration"),
          economyPrice: z.string().describe("Economy price like '$199'"),
        })).describe(`Up to ${CFG.maxResults} flights`),
      })
    );
  }

  recorder.record("extract", {
    instruction: "Extract flight results",
    description: `Extract up to ${CFG.maxResults} flights`,
    results: listings,
  });

  console.log(`📋 Found ${listings.flights.length} flights:`);
  listings.flights.forEach((f, i) => {
    console.log(`   ${i + 1}. ${f.itinerary}`);
    console.log(`      💲 ${f.economyPrice}`);
  });

  return listings;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Delta Air Lines – Round Trip Flight Search");
  console.log("  🔧 page.evaluate + page.click(x,y) + page.type()");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  ✈️  ${CFG.from} → ${CFG.to}`);
  console.log(`  📅 Dep: ${CFG.depDate}  Ret: ${CFG.retDate}\n`);

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient();
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
    console.log("🌐 Loading Delta Air Lines...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    console.log("✅ Loaded\n");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);

    await dismissPopups(stagehand, page);
    await selectBookTab(stagehand, page, recorder);
    await ensureRoundTrip(stagehand, page, recorder);
    await fillOrigin(stagehand, page, recorder, CFG.from);
    await fillDestination(stagehand, page, recorder, CFG.to);
    await fillDates(stagehand, page, recorder, CFG.depDate, CFG.retDate);

    // Verify form state — dump visible text near booking form
    console.log("🔍 Verifying form state...");
    const formSnapshot = await page.evaluate(`(() => {
      // Get text content of the booking form area
      const areas = document.querySelectorAll('#fromAirportName, #toAirportName, [id*="departureDate"], [id*="returnDate"]');
      const info = [];
      for (const el of areas) {
        if (el.offsetParent !== null || el.getClientRects().length > 0) {
          info.push({ id: el.id, text: (el.textContent || el.value || '').trim().substring(0, 60), tag: el.tagName });
        }
      }
      // Also check inputs
      const inputs = document.querySelectorAll('input');
      const vis = Array.from(inputs).filter(i => i.offsetParent !== null);
      for (const inp of vis) {
        if (['hidden','checkbox','radio'].includes(inp.type)) continue;
        if (inp.value) {
          info.push({ id: inp.id, text: inp.value.substring(0, 60), tag: 'INPUT', type: inp.type });
        }
      }
      return info;
    })()`);
    console.log("   📋 Form state:");
    formSnapshot.forEach(s => console.log(`      ${s.tag} #${s.id}: "${s.text}" ${s.type || ''}`));

    await clickSearch(stagehand, page, recorder);

    const listings = await extractResults(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${listings.flights.length} flights found`);
    console.log("═══════════════════════════════════════════════════════════");
    listings.flights.forEach((f, i) => console.log(`  ${i + 1}. ${f.itinerary} — ${f.economyPrice}`));

    // Save Python + JSON
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "delta_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python: ${pyPath}`);

    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions: ${jsonPath}`);

    return listings;

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder);
      fs.writeFileSync(path.join(__dirname, "delta_search.py"), pyScript, "utf-8");
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
