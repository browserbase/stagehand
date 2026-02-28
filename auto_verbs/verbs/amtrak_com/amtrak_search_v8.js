const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Amtrak – Train Ticket Search (One-Way)
 *
 * Concretized from live test on amtrak.com. DOM structure:
 *   - id="am-form-field-control-0"  placeholder="From"        → origin
 *   - id="am-form-field-control-2"  placeholder="To"          → destination
 *   - id="am-form-field-control-4"  placeholder="Depart Date" → date
 *   - "One-Way" clickable text in the trip type section
 *   - "FIND TRAINS" submit button
 *
 * Stagehand Page API:
 *   page.evaluate(expr)          — run JS in browser
 *   page.click(x, y)             — click at coordinates
 *   page.type(text, {delay})     — type into focused element
 *   page.keyPress("Ctrl+a")      — key combo
 */

// ── Date Computation ─────────────────────────────────────────────────────────
function computeDate() {
  const today = new Date();
  const dep = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const pad = (n) => String(n).padStart(2, "0");
  const MONTHS = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];
  return {
    iso: `${dep.getFullYear()}-${pad(dep.getMonth()+1)}-${pad(dep.getDate())}`,
    display: `${pad(dep.getMonth()+1)}/${pad(dep.getDate())}/${dep.getFullYear()}`,
    month: dep.getMonth(), year: dep.getFullYear(),
    day: dep.getDate(), monthName: MONTHS[dep.getMonth()],
  };
}
const depDate = computeDate();

// ── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.amtrak.com",
  from: "Seattle, WA",
  fromKeyword: "seattle",
  to: "Portland, OR",
  toKeyword: "portland",
  depISO: depDate.iso,
  depDisplay: depDate.display,
  depDay: depDate.day,
  depMonth: depDate.month,
  depYear: depDate.year,
  depMonthName: depDate.monthName,
  maxResults: 5,
  waits: { page: 5000, type: 3000, search: 15000 },
};

// ── genPython (read from disk) ───────────────────────────────────────────────
function genPython(cfg) {
  const pyPath = path.join(__dirname, "amtrak_search.py");
  if (fs.existsSync(pyPath)) {
    let c = fs.readFileSync(pyPath, "utf-8");
    c = c.replace(/origin:\s*str\s*=\s*"[^"]*"/, `origin: str = "${cfg.from}"`);
    c = c.replace(/destination:\s*str\s*=\s*"[^"]*"/, `destination: str = "${cfg.to}"`);
    c = c.replace(/max_results:\s*int\s*=\s*\d+/, `max_results: int = ${cfg.maxResults}`);
    return c;
  }
  return "# amtrak_search.py not found\n";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function scrollToTop(page) {
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(500);
}

async function dumpInputs(page) {
  const info = await page.evaluate(`(() => {
    const inputs = document.querySelectorAll('input');
    const result = [];
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width < 10) continue;
      result.push({
        id: inp.id, name: inp.name, type: inp.type,
        placeholder: inp.placeholder, ariaLabel: inp.getAttribute('aria-label'),
        value: inp.value,
        x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
    return result;
  })()`);
  console.log(`   📊 Inputs (${info.length}):`);
  for (const inp of info) {
    console.log(`      #${inp.id} type=${inp.type} ph="${inp.placeholder}" val="${inp.value}" @(${inp.x},${inp.y}) ${inp.w}x${inp.h}`);
  }
  return info;
}

// ── Step 0: Dismiss popups ──────────────────────────────────────────────────
async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  await page.waitForTimeout(2000);
  for (let i = 0; i < 3; i++) {
    const clicked = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button, a, [role="button"]');
      for (const btn of btns) {
        const txt = (btn.textContent || btn.getAttribute('aria-label') || '').trim().toLowerCase();
        if (['close','dismiss','accept','got it','ok','no thanks','not now',
             'accept all cookies','accept all'].includes(txt)
            || txt === 'close' || txt === 'accept') {
          if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
            btn.click(); return txt;
          }
        }
      }
      return false;
    })()`);
    if (clicked) {
      console.log(`   ✅ Dismissed: "${clicked}"`);
      await page.waitForTimeout(800);
    } else break;
  }
  await page.waitForTimeout(800);

  // Remove OneTrust cookie overlay which blocks ALL coordinate clicks
  const overlayRemoved = await page.evaluate(`(() => {
    let removed = 0;
    // Remove the dark filter overlay
    const darkFilter = document.querySelector('.onetrust-pc-dark-filter');
    if (darkFilter) { darkFilter.remove(); removed++; }
    // Hide the cookie banner
    const banner = document.getElementById('onetrust-banner-sdk');
    if (banner) { banner.style.display = 'none'; removed++; }
    // Disable pointer events on any remaining OneTrust overlays
    const otOverlays = document.querySelectorAll('[class*="onetrust"], [class*="ot-sdk"], .optanon-alert-box-wrapper');
    for (const el of otOverlays) {
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
      removed++;
    }
    return removed;
  })()`);
  if (overlayRemoved > 0) console.log(`   ✅ Removed ${overlayRemoved} OneTrust overlay(s)`);
}

// ── Step 1: Select One-Way ──────────────────────────────────────────────────
async function selectOneWay(stagehand, page, recorder) {
  console.log("🎯 STEP 0: Select One-Way...");
  await scrollToTop(page);

  // First, find and diagnose all trip-type options
  const tripTypes = await page.evaluate(`(() => {
    const all = document.querySelectorAll(
      'button, label, input[type="radio"], a, div[role="tab"], li, span, mat-radio-button'
    );
    const items = [];
    for (const el of all) {
      const text = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase().trim();
      if ((text.includes('one-way') || text.includes('round') || text.includes('one way')) && text.length < 30) {
        if (el.offsetParent !== null || el.getClientRects().length > 0) {
          const r = el.getBoundingClientRect();
          if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < 700) {
            items.push({
              text, tag: el.tagName, cls: el.className.toString().substring(0, 80),
              role: el.getAttribute('role'), ariaSelected: el.getAttribute('aria-selected'),
              x: r.x + r.width/2, y: r.y + r.height/2
            });
          }
        }
      }
    }
    return items;
  })()`);
  console.log(`   📊 Trip type options:`, JSON.stringify(tripTypes, null, 2));

  // Click one-way — prefer the one with role="tab" or an <a> tag
  let clicked = null;
  for (const item of tripTypes) {
    if (item.text.includes('one-way') || item.text === 'one way') {
      clicked = item;
      if (item.role === 'tab' || item.tag === 'A' || item.tag === 'LABEL') break; // prefer these
    }
  }

  if (clicked) {
    await page.click(clicked.x, clicked.y);
    console.log(`   ✅ Clicked: "${clicked.text}" (${clicked.tag}, role=${clicked.role})`);
  } else {
    console.log("   ⚠️ One-Way not found via diagnostic, trying text match...");
    const fallback = await page.evaluate(`(() => {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim().toLowerCase();
        if (text === 'one-way') {
          const r = el.getBoundingClientRect();
          if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < 700) {
            return { x: r.x + r.width/2, y: r.y + r.height/2, text, tag: el.tagName };
          }
        }
      }
      return null;
    })()`);
    if (fallback) {
      await page.click(fallback.x, fallback.y);
      console.log(`   ✅ Fallback click: "${fallback.text}" (${fallback.tag})`);
    }
  }
  await page.waitForTimeout(1500);

  // Verify one-way mode: check if Return Date field is visible/required
  const oneWayCheck = await page.evaluate(`(() => {
    // Check trip type tabs
    const tabs = document.querySelectorAll('[role="tab"]');
    const activeTab = [];
    for (const t of tabs) {
      const text = (t.textContent || '').trim().toLowerCase();
      const selected = t.getAttribute('aria-selected') === 'true';
      if (text.includes('one-way') || text.includes('round')) {
        activeTab.push({ text, selected });
      }
    }

    // Check if Return Date input is visible
    const allInputs = document.querySelectorAll('input');
    let returnDateVisible = false;
    for (const inp of allInputs) {
      const ph = (inp.placeholder || '').toLowerCase();
      if (ph.includes('return')) {
        returnDateVisible = (inp.offsetParent !== null || inp.getClientRects().length > 0);
      }
    }

    // Check FIND TRAINS button disabled state
    const btns = document.querySelectorAll('button');
    let findTrainsDisabled = null;
    for (const b of btns) {
      if ((b.textContent || '').toLowerCase().includes('find trains')) {
        if (b.offsetParent !== null) {
          findTrainsDisabled = b.disabled;
          break;
        }
      }
    }

    return { tabs: activeTab, returnDateVisible, findTrainsDisabled };
  })()`);
  console.log(`   📊 One-way verification:`, JSON.stringify(oneWayCheck));

  // If return date is still visible, try programmatic click on the one-way tab
  if (oneWayCheck.returnDateVisible || (oneWayCheck.tabs.length > 0 && !oneWayCheck.tabs.some(t => t.text.includes('one-way') && t.selected))) {
    console.log("   ⚠️ One-way not active — trying programmatic tab click...");
    await page.evaluate(`(() => {
      const tabs = document.querySelectorAll('[role="tab"]');
      for (const t of tabs) {
        if ((t.textContent || '').toLowerCase().includes('one-way')) {
          t.click();
          return true;
        }
      }
      // Try clicking any element that says one-way
      const all = document.querySelectorAll('a, button, label, span, li');
      for (const el of all) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text === 'one-way' || text === 'one way') {
          el.click();
          return true;
        }
      }
      return false;
    })()`);
    await page.waitForTimeout(1500);

    // Re-check
    const recheck = await page.evaluate(`(() => {
      const allInputs = document.querySelectorAll('input');
      let returnDateVisible = false;
      for (const inp of allInputs) {
        const ph = (inp.placeholder || '').toLowerCase();
        if (ph.includes('return')) {
          returnDateVisible = (inp.offsetParent !== null || inp.getClientRects().length > 0);
        }
      }
      const btns = document.querySelectorAll('button');
      let findTrainsDisabled = null;
      for (const b of btns) {
        if ((b.textContent || '').toLowerCase().includes('find trains') && b.offsetParent !== null) {
          findTrainsDisabled = b.disabled;
          break;
        }
      }
      return { returnDateVisible, findTrainsDisabled };
    })()`);
    console.log(`   📊 Re-check after programmatic click:`, JSON.stringify(recheck));
  }

  recorder.record("act", { instruction: "Select One-Way" });
}

// ── Step 2/3: Enter station ─────────────────────────────────────────────────
async function enterStation(stagehand, page, recorder, which, text, keyword) {
  const isOrigin = which === "origin";
  const label = isOrigin ? "Origin (From)" : "Destination (To)";
  const stepNum = isOrigin ? 1 : 2;
  console.log(`🎯 STEP ${stepNum}: ${label} = "${text}"...`);

  await scrollToTop(page);
  await page.waitForTimeout(500);

  // Use known Amtrak input IDs
  // am-form-field-control-0 = From
  // am-form-field-control-2 = To
  const targetId = isOrigin ? "am-form-field-control-0" : "am-form-field-control-2";
  const targetPh = isOrigin ? "From" : "To";

  const field = await page.evaluate(`((targetId, targetPh) => {
    // Strategy 1: by known ID
    const byId = document.getElementById(targetId);
    if (byId) {
      const r = byId.getBoundingClientRect();
      if (r.width > 30) return { x: r.x + r.width/2, y: r.y + r.height/2, method: 'id:' + targetId };
    }
    // Strategy 2: by placeholder
    const inputs = document.querySelectorAll('input[placeholder="' + targetPh + '"]');
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width > 30) return { x: r.x + r.width/2, y: r.y + r.height/2, method: 'placeholder:' + targetPh };
    }
    // Strategy 3: by aria-label
    const byAria = document.querySelectorAll('input[aria-label="' + targetPh + '"]');
    for (const inp of byAria) {
      const r = inp.getBoundingClientRect();
      if (r.width > 30) return { x: r.x + r.width/2, y: r.y + r.height/2, method: 'aria:' + targetPh };
    }
    return null;
  })("${targetId}", "${targetPh}")`);

  if (field) {
    console.log(`   ✅ Found field (${field.method})`);
    // Click at coordinates first (triggers Angular bindings)
    await page.click(field.x, field.y);
    await page.waitForTimeout(500);
  } else {
    console.log(`   ⚠️ Field not found by ID/placeholder, using AI...`);
    await stagehand.act(`Click on the '${targetPh}' station input field`);
    await page.waitForTimeout(500);
  }

  // Ensure focus is on the target input (critical — Amtrak's Angular steals focus)
  const focusOK = await page.evaluate(`((targetId) => {
    const inp = document.getElementById(targetId);
    if (!inp) return false;
    inp.focus();
    inp.click();
    inp.select();
    return document.activeElement === inp;
  })("${targetId}")`);
  console.log(`   📊 Focus on #${targetId}: ${focusOK}`);
  await page.waitForTimeout(300);

  // Clear any existing value
  await page.keyPress("Ctrl+a");
  await page.waitForTimeout(150);
  await page.keyPress("Backspace");
  await page.waitForTimeout(300);

  // Type the station name character by character
  await page.type(text, { delay: 100 });
  await page.waitForTimeout(500);

  // Verify the input received the typed text
  const afterType = await page.evaluate(`((targetId) => {
    const inp = document.getElementById(targetId);
    if (!inp) return { value: '', activeId: document.activeElement ? document.activeElement.id : 'N/A' };
    return { value: inp.value, activeId: document.activeElement ? document.activeElement.id : 'N/A' };
  })("${targetId}")`);
  console.log(`   📊 After typing: value="${afterType.value}" activeElement=#${afterType.activeId}`);

  // If typing didn't populate the field, inject value via JS
  if (!afterType.value || afterType.value.length < 3) {
    console.log("   ⚠️ Typing didn't populate — injecting value via JS...");
    await page.evaluate(`((targetId, value) => {
      const inp = document.getElementById(targetId);
      if (!inp) return;
      inp.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(inp, value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    })("${targetId}", "${text}")`);
    console.log(`   ✅ Injected "${text}"`);
    await page.waitForTimeout(500);
  } else {
    console.log(`   ✅ Typed "${text}"`);
  }

  // Wait for autocomplete suggestions
  await page.waitForTimeout(CFG.waits.type);

  // Dump all elements matching the keyword for debugging
  const debugMatches = await page.evaluate(`((keyword) => {
    const all = document.querySelectorAll('*');
    const matches = [];
    for (const el of all) {
      const t = (el.textContent || '').trim();
      if (t.toLowerCase().includes(keyword) && t.length < 150 && t.length > keyword.length) {
        const r = el.getBoundingClientRect();
        if (r.width > 10 && r.height > 5) {
          matches.push({
            tag: el.tagName, cls: (el.className || '').toString().substring(0,60),
            role: el.getAttribute('role'), text: t.substring(0,80),
            vis: el.offsetParent !== null || el.getClientRects().length > 0,
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          });
        }
      }
    }
    return matches.slice(0, 20);
  })("${keyword}")`);
  console.log(`   📊 DOM elements containing "${keyword}": ${debugMatches.length}`);
  for (const m of debugMatches.slice(0, 8)) {
    console.log(`      <${m.tag}> role=${m.role} cls="${m.cls}" vis=${m.vis} "${m.text}" @(${m.x},${m.y}) ${m.w}x${m.h}`);
  }

  // Look for autocomplete suggestion
  const sug = await page.evaluate(`((keyword) => {
    const selectors = [
      'mat-option', '[role="option"]', '[role="listbox"] > *',
      'li.suggestion', 'li[id*="option"]', '.autocomplete-item',
      '.station-list-item', '.dropdown-item', 'ul.suggestions li',
      'div[class*="option"]', 'button[class*="option"]',
      // Amtrak-specific
      'mat-autocomplete mat-option', '.mat-option', '.mat-autocomplete-panel mat-option',
      '[class*="station"] li', '[class*="station-item"]',
    ];
    // Match by keyword
    for (const sel of selectors) {
      try {
        const items = document.querySelectorAll(sel);
        for (const el of items) {
          const t = (el.textContent || '').trim();
          if (t.length > 2 && t.length < 200 && t.toLowerCase().includes(keyword)) {
            if (el.offsetParent !== null || el.getClientRects().length > 0) {
              const r = el.getBoundingClientRect();
              if (r.width > 30 && r.height > 10 && r.y > 0)
                return { x: r.x + r.width/2, y: r.y + r.height/2, text: t.substring(0,80), sel };
            }
          }
        }
      } catch(e) {}
    }
    // Any visible option element
    for (const sel of ['mat-option', '[role="option"]', '.mat-option']) {
      try {
        const items = document.querySelectorAll(sel);
        if (items.length > 0 && items.length < 20) {
          for (const el of items) {
            if (el.offsetParent !== null || el.getClientRects().length > 0) {
              const r = el.getBoundingClientRect();
              if (r.width > 30 && r.height > 10 && r.y > 0)
                return { x: r.x + r.width/2, y: r.y + r.height/2, text: (el.textContent||'').trim().substring(0,80), sel };
            }
          }
        }
      } catch(e) {}
    }
    return null;
  })("${keyword}")`);

  if (sug) {
    console.log(`   📊 Found autocomplete option: "${sug.text}" (${sug.sel})`);

    // Dump option DOM structure for diagnostics
    const optDOM = await page.evaluate(`(() => {
      const opt = document.querySelector('[role="option"]');
      if (!opt) return null;
      return {
        outer: opt.outerHTML.substring(0, 400),
        childCount: opt.children.length,
        children: Array.from(opt.children).map(c => ({ tag: c.tagName, cls: (c.className||'').substring(0,40), text: c.textContent.trim().substring(0,50) })),
        parentTag: opt.parentElement ? opt.parentElement.tagName : '',
        parentRole: opt.parentElement ? opt.parentElement.getAttribute('role') : '',
        parentCls: opt.parentElement ? (opt.parentElement.className||'').substring(0,80) : '',
      };
    })()`);
    if (optDOM) console.log(`   📊 Option DOM:`, JSON.stringify(optDOM, null, 2));

    // Helper: check if the field became ng-valid
    const checkFieldValid = async () => {
      return await page.evaluate(`(() => {
        const inp = document.getElementById("${targetId}");
        if (!inp) return { valid: false, value: '' };
        const cls = inp.className || '';
        return { valid: cls.includes('ng-valid') && !cls.includes('ng-invalid'), value: inp.value };
      })()`);
    };

    // Helper: re-type text and wait for autocomplete to reappear
    const retypeAndWait = async () => {
      await page.evaluate(`(() => { const inp = document.getElementById("${targetId}"); if (inp) { inp.focus(); inp.select(); } })()`);
      await page.waitForTimeout(200);
      await page.keyPress("Ctrl+a");
      await page.waitForTimeout(100);
      await page.keyPress("Backspace");
      await page.waitForTimeout(300);
      await page.type(text, { delay: 80 });
      await page.waitForTimeout(CFG.waits.type);
    };

    let selectionValid = false;

    // ── Strategy 1: Stagehand observe + act (recommended V3 pattern) ──
    if (!selectionValid) {
      const fullName = isOrigin ? "Seattle, WA - King Street Station" : "Portland, OR - Union Station";
      console.log(`   🎯 Strategy 1: observe+act for '${fullName}'...`);
      try {
        const actions = await stagehand.observe(`Click on the autocomplete suggestion that says '${fullName}'`);
        if (actions.length > 0) {
          await stagehand.act(actions[0]);
          await page.waitForTimeout(1000);
        } else {
          console.log(`   ℹ️ observe returned 0 actions`);
        }
      } catch (e) {
        console.log(`   ⚠️ Strategy 1 error: ${e.message}`);
      }
      const v = await checkFieldValid();
      console.log(`   📊 After Strategy 1: valid=${v.valid} value="${v.value}"`);
      if (v.valid) selectionValid = true;
    }

    // ── Strategy 2: Playwright coordinate click (trusted events) + elementFromPoint check ──
    if (!selectionValid) {
      console.log(`   🎯 Strategy 2: Coordinate click with elementFromPoint...`);
      await retypeAndWait();
      const sug2 = await page.evaluate(`((keyword) => {
        const items = document.querySelectorAll('[role="option"]');
        for (const el of items) {
          const t = (el.textContent || '').trim();
          if (t.toLowerCase().includes(keyword)) {
            if (el.offsetParent !== null) {
              const r = el.getBoundingClientRect();
              const cx = r.x + r.width/2, cy = r.y + r.height/2;
              const hit = document.elementFromPoint(cx, cy);
              if (r.width > 30 && r.height > 10 && r.y > 0)
                return { x: cx, y: cy, text: t.substring(0,80),
                  hitTag: hit ? hit.tagName : 'none', hitSame: hit === el,
                  hitCls: hit ? (hit.className||'').substring(0,60) : '',
                  hitText: hit ? hit.textContent.trim().substring(0,50) : '' };
            }
          }
        }
        return null;
      })("${keyword}")`);
      if (sug2) {
        console.log(`   📊 elementFromPoint: tag=${sug2.hitTag} same=${sug2.hitSame} cls="${sug2.hitCls}"`);
        // If a child element is at the coordinates, click it directly
        if (!sug2.hitSame && sug2.hitTag !== 'none') {
          console.log(`   ℹ️ Clicking child element instead: ${sug2.hitTag} "${sug2.hitText}"`);
        }
        await page.click(sug2.x, sug2.y);
        console.log(`   ✅ Clicked at (${Math.round(sug2.x)}, ${Math.round(sug2.y)})`);
        await page.waitForTimeout(1000);
      }
      const v = await checkFieldValid();
      console.log(`   📊 After Strategy 2: valid=${v.valid} value="${v.value}"`);
      if (v.valid) selectionValid = true;
    }

    // ── Strategy 3: Full MouseEvent dispatch (mouseenter + pointer + click on option AND children) ──
    if (!selectionValid) {
      console.log(`   🎯 Strategy 3: Full event dispatch...`);
      await retypeAndWait();
      await page.evaluate(`((keyword) => {
        const opts = document.querySelectorAll('[role="option"]');
        for (const opt of opts) {
          if ((opt.textContent||'').toLowerCase().includes(keyword)) {
            const r = opt.getBoundingClientRect();
            const evBase = { bubbles: true, cancelable: true, view: window,
              clientX: r.x+r.width/2, clientY: r.y+r.height/2 };
            // Hover sequence
            opt.dispatchEvent(new MouseEvent('mouseover', evBase));
            opt.dispatchEvent(new MouseEvent('mouseenter', { ...evBase, bubbles: false }));
            opt.dispatchEvent(new MouseEvent('mousemove', evBase));
            // Pointer/Mouse down-up-click
            opt.dispatchEvent(new PointerEvent('pointerdown', { ...evBase, pointerId: 1 }));
            opt.dispatchEvent(new MouseEvent('mousedown', { ...evBase, button: 0 }));
            opt.dispatchEvent(new PointerEvent('pointerup', { ...evBase, pointerId: 1 }));
            opt.dispatchEvent(new MouseEvent('mouseup', { ...evBase, button: 0 }));
            opt.dispatchEvent(new MouseEvent('click', { ...evBase, button: 0 }));
            // Also dispatch click on all child elements (handler may be on inner span/div)
            for (const ch of opt.querySelectorAll('*')) {
              ch.dispatchEvent(new MouseEvent('click', { ...evBase, button: 0 }));
            }
            break;
          }
        }
      })("${keyword}")`);
      await page.waitForTimeout(1000);
      const v = await checkFieldValid();
      console.log(`   📊 After Strategy 3: valid=${v.valid} value="${v.value}"`);
      if (v.valid) selectionValid = true;
    }

    // ── Strategy 4: Keyboard ArrowDown + Enter ──
    if (!selectionValid) {
      console.log(`   🎯 Strategy 4: Keyboard ArrowDown + Enter...`);
      await retypeAndWait();
      await page.keyPress("ArrowDown");
      await page.waitForTimeout(300);
      await page.keyPress("Enter");
      await page.waitForTimeout(1000);
      const v = await checkFieldValid();
      console.log(`   📊 After Strategy 4: valid=${v.valid} value="${v.value}"`);
      if (v.valid) selectionValid = true;
    }

    // ── Strategy 5: Tab to accept first suggestion ──
    if (!selectionValid) {
      console.log(`   🎯 Strategy 5: Tab to accept...`);
      await retypeAndWait();
      await page.keyPress("Tab");
      await page.waitForTimeout(1000);
      const v = await checkFieldValid();
      console.log(`   📊 After Strategy 5: valid=${v.valid} value="${v.value}"`);
      if (v.valid) selectionValid = true;
    }

    // Dump intercepted API calls for diagnostics
    const apiCalls = await page.evaluate(`(window.__apiLog || []).filter(r =>
      r.url.includes('station') || r.url.includes('autocomplete') || r.url.includes('api')
    ).slice(0, 8)`);
    if (apiCalls.length > 0) {
      console.log(`   📡 Intercepted API calls:`);
      for (const c of apiCalls) console.log(`      ${c.m} ${c.url}`);
    }

    console.log(`   ${selectionValid ? '✅' : '⚠️'} Selection ${selectionValid ? 'succeeded (ng-valid)' : 'FAILED (ng-invalid)'}: "${sug.text}"`);
  } else {
    console.log("   ℹ️ No autocomplete — pressing Enter to accept typed value");

    // Re-focus, press Enter
    await page.evaluate(`(() => {
      const inp = document.getElementById("${targetId}");
      if (inp) { inp.focus(); }
    })()`);
    await page.keyPress("Enter");
    await page.waitForTimeout(1500);

    // Check again for dropdown after Enter
    const sug2 = await page.evaluate(`((keyword) => {
      const selectors = ['mat-option', '[role="option"]', 'ul li', '.mat-option', '[role="listbox"] > *'];
      for (const sel of selectors) {
        try {
          const items = document.querySelectorAll(sel);
          for (const el of items) {
            const t = (el.textContent || '').trim();
            if (t.length > 2 && t.length < 200 && t.toLowerCase().includes(keyword)) {
              if (el.offsetParent !== null || el.getClientRects().length > 0) {
                const r = el.getBoundingClientRect();
                if (r.width > 30 && r.height > 10 && r.y > 0)
                  return { x: r.x + r.width/2, y: r.y + r.height/2, text: t.substring(0,80) };
              }
            }
          }
        } catch(e) {}
      }
      return null;
    })("${keyword}")`);
    if (sug2) {
      await page.click(sug2.x, sug2.y);
      console.log(`   ✅ Selected after Enter: "${sug2.text}"`);
    } else {
      // Last resort: Tab out to trigger AngularMaterial to accept
      await page.evaluate(`(() => {
        const inp = document.getElementById("${targetId}");
        if (inp) { inp.focus(); }
      })()`);
      await page.keyPress("Tab");
      console.log("   ℹ️ Pressed Tab to accept");
    }
  }

  await page.waitForTimeout(1000);
  recorder.record("act", { instruction: `${label}: ${text}` });
}

// ── Step 4: Set departure date ──────────────────────────────────────────────
async function setDate(stagehand, page, recorder) {
  console.log(`🎯 STEP 3: Date = ${CFG.depDisplay} (${CFG.depMonthName} ${CFG.depDay}, ${CFG.depYear})...`);
  await scrollToTop(page);
  await page.waitForTimeout(500);

  // Click on the Depart Date field (known ID)
  const dateField = await page.evaluate(`(() => {
    const inp = document.getElementById("am-form-field-control-4");
    if (inp) {
      const r = inp.getBoundingClientRect();
      if (r.width > 20) return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }
    const inputs = document.querySelectorAll('input[placeholder="Depart Date"], input[placeholder*="Depart"]');
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width > 20) return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }
    return null;
  })()`);

  if (dateField) {
    await page.click(dateField.x, dateField.y);
    console.log("   ✅ Clicked Depart Date field");
    await page.waitForTimeout(800);
  } else {
    console.log("   ⚠️ Depart Date field not found by ID, trying AI...");
    await stagehand.act("Click the departure date field");
    await page.waitForTimeout(800);
  }

  // Ensure focus on the date input to trigger the datepicker
  await page.evaluate(`(() => {
    const inp = document.getElementById("am-form-field-control-4");
    if (inp) { inp.focus(); inp.click(); }
  })()`);
  await page.waitForTimeout(2000);

  // === DIAGNOSTIC: dump ngb-datepicker + calendar structure ===
  const calDiag = await page.evaluate(`(() => {
    const diag = { ngb: {}, mat: {}, grids: 0, nextBtns: [], monthLabels: [] };
    // ng-bootstrap datepicker
    const ngb = document.querySelector('ngb-datepicker');
    if (ngb) {
      diag.ngb.found = true;
      diag.ngb.visible = ngb.offsetParent !== null || ngb.getClientRects().length > 0;
      diag.ngb.cls = (ngb.className || '').toString().substring(0, 120);
      // Month name
      const mn = ngb.querySelector('.ngb-dp-month-name');
      diag.ngb.monthName = mn ? mn.textContent.trim() : '';
      // Arrow buttons
      const arrows = ngb.querySelectorAll('.ngb-dp-arrow-btn, [class*="ngb-dp-arrow"]');
      diag.ngb.arrows = [];
      for (const a of arrows) {
        const r = a.getBoundingClientRect();
        diag.ngb.arrows.push({ aria: a.getAttribute('aria-label'), cls: (a.className||'').toString().substring(0,60), x: r.x, y: r.y, w: r.width, h: r.height });
      }
      // Day cells
      const days = ngb.querySelectorAll('[ngbDatepickerDayView], .ngb-dp-day > div, [role="gridcell"]');
      diag.ngb.dayCells = days.length;
      diag.ngb.daySamples = [];
      for (let i = 0; i < Math.min(5, days.length); i++) {
        diag.ngb.daySamples.push({ text: days[i].textContent.trim(), aria: days[i].getAttribute('aria-label'), tag: days[i].tagName });
      }
    } else {
      diag.ngb.found = false;
    }
    // mat-calendar
    const mc = document.querySelector('mat-calendar');
    diag.mat.found = !!mc;
    // Grids
    diag.grids = document.querySelectorAll('[role="grid"]').length;
    // All buttons with "next month" aria
    const allBtns = document.querySelectorAll('button');
    for (const b of allBtns) {
      const aria = (b.getAttribute('aria-label') || '');
      if (aria.toLowerCase().includes('next') || aria.toLowerCase().includes('previous')) {
        const r = b.getBoundingClientRect();
        diag.nextBtns.push({ aria, cls: (b.className||'').toString().substring(0,80), x: r.x, y: r.y, w: r.width, h: r.height, vis: b.offsetParent !== null });
      }
    }
    // Month labels from various selectors
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const labels = document.querySelectorAll('.ngb-dp-month-name, .mat-calendar-period-button, [class*="month-name"], [class*="period"]');
    for (const l of labels) {
      const t = l.textContent.trim();
      if (t.length < 40) diag.monthLabels.push({ text: t, cls: (l.className||'').toString().substring(0,60), vis: l.offsetParent !== null });
    }
    return diag;
  })()`);
  console.log("   📊 Calendar diagnostic:", JSON.stringify(calDiag, null, 2));

  // === Detect calendar ===
  const calInfo = await page.evaluate(`(() => {
    const info = { hasCalendar: false, dayCells: 0, monthLabel: '', calType: '' };
    // 1. ng-bootstrap datepicker (Amtrak uses this!)
    const ngb = document.querySelector('ngb-datepicker');
    if (ngb && (ngb.offsetParent !== null || ngb.getClientRects().length > 0)) {
      const cells = ngb.querySelectorAll('[role="gridcell"]');
      if (cells.length >= 7) {
        info.hasCalendar = true; info.dayCells = cells.length; info.calType = 'ngb-datepicker';
        const mn = ngb.querySelector('.ngb-dp-month-name');
        if (mn) info.monthLabel = mn.textContent.trim();
      }
    }
    // 2. Angular Material mat-calendar
    if (!info.hasCalendar) {
      const matCal = document.querySelector('mat-calendar');
      if (matCal && (matCal.offsetParent !== null || matCal.getClientRects().length > 0)) {
        const cells = matCal.querySelectorAll('.mat-calendar-body-cell');
        if (cells.length >= 7) {
          info.hasCalendar = true; info.dayCells = cells.length; info.calType = 'mat-calendar';
          const pb = matCal.querySelector('.mat-calendar-period-button');
          if (pb) info.monthLabel = pb.textContent.trim();
        }
      }
    }
    // 3. Generic role="grid" with size constraints
    if (!info.hasCalendar) {
      const grids = document.querySelectorAll('[role="grid"]');
      for (const g of grids) {
        if (g.offsetParent !== null || g.getClientRects().length > 0) {
          const r = g.getBoundingClientRect();
          if (r.width < 500 && r.width > 100 && r.y > 0 && r.y < 600) {
            const cells = g.querySelectorAll('[role="gridcell"]');
            if (cells.length >= 7 && cells.length <= 60) {
              info.hasCalendar = true; info.dayCells = cells.length; info.calType = 'role-grid';
              // Try to find month label nearby
              const months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
              const parent = g.closest('ngb-datepicker') || g.parentElement;
              if (parent) {
                const labels = parent.querySelectorAll('.ngb-dp-month-name, button, span, h2');
                for (const l of labels) {
                  const t = l.textContent.trim();
                  if (t.length < 40 && months.some(m => t.includes(m))) { info.monthLabel = t; break; }
                }
              }
            }
          }
        }
      }
    }
    return info;
  })()`);
  console.log(`   📊 Calendar: has=${calInfo.hasCalendar}, cells=${calInfo.dayCells}, type="${calInfo.calType}", month="${calInfo.monthLabel}"`);

  let dateSet = false;

  if (calInfo.hasCalendar) {
    // ── Navigate to the correct month ──
    // The calendar shows 2 months at a time. We need April visible somewhere.
    for (let i = 0; i < 12; i++) {
      // Read ALL month labels from the calendar (ngb shows 2 at once)
      const monthCheck = await page.evaluate(`(() => {
        const labels = document.querySelectorAll('.ngb-dp-month-name');
        const result = [];
        for (const l of labels) {
          if (l.offsetParent !== null || l.getClientRects().length > 0)
            result.push(l.textContent.trim());
        }
        // Also check mat-calendar period button
        const pb = document.querySelector('.mat-calendar-period-button');
        if (pb && (pb.offsetParent !== null || pb.getClientRects().length > 0))
          result.push(pb.textContent.trim());
        // Check if calendar is still open
        const ngb = document.querySelector('ngb-datepicker');
        const calOpen = ngb ? (ngb.offsetParent !== null || ngb.getClientRects().length > 0) : false;
        return { labels: result, calOpen };
      })()`);
      console.log(`   📅 Nav iteration ${i}: labels=[${monthCheck.labels.join(', ')}] calOpen=${monthCheck.calOpen}`);

      // Check if target month is visible in ANY label
      const targetVisible = monthCheck.labels.some(l =>
        l.includes(CFG.depMonthName) && l.includes(String(CFG.depYear)));
      if (targetVisible) {
        console.log(`   ✅ Calendar shows ${CFG.depMonthName} ${CFG.depYear}`);
        break;
      }

      // If calendar closed, reopen it
      if (!monthCheck.calOpen) {
        console.log("   ℹ️ Calendar closed — reopening...");
        const df = await page.evaluate(`(() => {
          const inp = document.getElementById("am-form-field-control-4");
          if (inp) { inp.focus(); inp.click(); const r = inp.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 }; }
          return null;
        })()`);
        if (df) { await page.click(df.x, df.y); }
        await page.waitForTimeout(1500);
        continue; // Re-check month labels after reopening
      }

      // Click Next month using PROGRAMMATIC DOM click (avoids calendar close from coordinate click)
      const clicked = await page.evaluate(`(() => {
        // Try ngb-dp-arrow-btn with "Next month" aria-label
        const btns = document.querySelectorAll('.ngb-dp-arrow-btn, button[aria-label="Next month"]');
        for (const b of btns) {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          if (aria.includes('next month')) {
            b.click(); // Programmatic click — no coordinate dispatch, no blur
            return 'ngb-aria';
          }
        }
        // Try mat-calendar-next-button
        const matNext = document.querySelector('.mat-calendar-next-button');
        if (matNext) { matNext.click(); return 'mat-next'; }
        return null;
      })()`);
      if (clicked) {
        console.log(`   ➡️ Programmatic Next click (${clicked})`);
        await page.waitForTimeout(800);
      } else {
        console.log("   ⚠️ No Next button found — cannot navigate months");
        break;
      }
    }

    // ── Click the target day ──
    await page.waitForTimeout(500);

    // Verify calendar is still open before clicking day
    const calStillOpen = await page.evaluate(`(() => {
      const ngb = document.querySelector('ngb-datepicker');
      return ngb ? (ngb.offsetParent !== null || ngb.getClientRects().length > 0) : false;
    })()`);
    if (!calStillOpen) {
      console.log("   ℹ️ Calendar closed before day click — reopening...");
      const df = await page.evaluate(`(() => {
        const inp = document.getElementById("am-form-field-control-4");
        if (inp) { inp.focus(); inp.click(); const r = inp.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 }; }
        return null;
      })()`);
      if (df) { await page.click(df.x, df.y); }
      await page.waitForTimeout(2000);
      // Navigate again if needed
      for (let j = 0; j < 6; j++) {
        const labels = await page.evaluate(`(() => {
          const els = document.querySelectorAll('.ngb-dp-month-name');
          return Array.from(els).filter(e => e.offsetParent !== null).map(e => e.textContent.trim());
        })()`);
        if (labels.some(l => l.includes(CFG.depMonthName) && l.includes(String(CFG.depYear)))) break;
        await page.evaluate(`(() => {
          const btns = document.querySelectorAll('.ngb-dp-arrow-btn, button[aria-label="Next month"]');
          for (const b of btns) {
            if ((b.getAttribute('aria-label') || '').toLowerCase().includes('next month')) { b.click(); return; }
          }
        })()`);
        await page.waitForTimeout(800);
      }
    }

    // The target date's aria-label format is "Weekday, Month Day, Year" e.g. "Monday, April 27, 2026"
    // Return coordinates for TRUSTED Playwright click (not programmatic el.click() which is untrusted)
    const dc = await page.evaluate(`(() => {
      const day = "${CFG.depDay}";
      const monthName = "${CFG.depMonthName}";
      const year = "${CFG.depYear}";

      // 1. Try aria-label match (most reliable for ngb-datepicker)
      //    Format: "Weekday, MonthName Day, Year" e.g. "Monday, April 27, 2026"
      const allDivs = document.querySelectorAll('[aria-label]');
      for (const el of allDivs) {
        const aria = el.getAttribute('aria-label') || '';
        if (aria.includes(monthName + ' ' + day + ', ' + year)) {
          if (el.offsetParent !== null || el.getClientRects().length > 0) {
            const r = el.getBoundingClientRect();
            if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < 600) {
              return { m: 'aria-full', aria, tag: el.tagName, x: r.x+r.width/2, y: r.y+r.height/2 };
            }
          }
        }
      }
      // 2. Try partial aria-label: "April 27"
      for (const el of allDivs) {
        const aria = el.getAttribute('aria-label') || '';
        if (aria.includes(monthName + ' ' + day)) {
          if (el.offsetParent !== null || el.getClientRects().length > 0) {
            const r = el.getBoundingClientRect();
            if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < 600) {
              return { m: 'aria-partial', aria, tag: el.tagName, x: r.x+r.width/2, y: r.y+r.height/2 };
            }
          }
        }
      }
      // 3. [role="gridcell"] text match within the calendar area
      const ngb = document.querySelector('ngb-datepicker');
      const scope = ngb || document;
      const cells = scope.querySelectorAll('[role="gridcell"]');
      for (const c of cells) {
        const t = (c.textContent || '').trim();
        if (t === day || t === String(parseInt(day))) {
          if (c.offsetParent !== null || c.getClientRects().length > 0) {
            const r = c.getBoundingClientRect();
            if (r.width >= 10 && r.height >= 10 && r.width <= 150) {
              return { m: 'gridcell-text', tag: c.tagName, x: r.x+r.width/2, y: r.y+r.height/2 };
            }
          }
        }
      }
      return null;
    })()`);
    if (dc) {
      let dateValid = false;

      // Re-remove OneTrust overlay in case it reappeared
      await page.evaluate(`(() => {
        const o = document.querySelector('.onetrust-pc-dark-filter');
        if (o) o.remove();
        const els = document.querySelectorAll('[class*="onetrust"]');
        for (const el of els) { el.style.pointerEvents = 'none'; el.style.display = 'none'; }
      })()`);

      // ── Date Strategy 1: Playwright trusted coordinate click (overlay removed) ──
      console.log(`   🎯 Date Strategy 1: Trusted Playwright click...`);
      await page.click(dc.x, dc.y);
      await page.waitForTimeout(1000);
      let ds = await page.evaluate(`(() => {
        const inp = document.getElementById("am-form-field-control-4");
        if (!inp) return { value: '', valid: false };
        const cls = inp.className || '';
        return { value: inp.value, valid: cls.includes('ng-valid') && !cls.includes('ng-invalid') };
      })()`);
      console.log(`   📊 After Date Strategy 1: value="${ds.value}" valid=${ds.valid}`);
      if (ds.valid) dateValid = true;

      // ── Date Strategy 2: Stagehand observe+act ──
      if (!dateValid) {
        console.log(`   🎯 Date Strategy 2: observe+act to click day ${CFG.depDay}...`);
        // Calendar may have closed, reopen it
        const calOpen = await page.evaluate(`(() => {
          const ngb = document.querySelector('ngb-datepicker');
          return ngb ? (ngb.offsetParent !== null || ngb.getClientRects().length > 0) : false;
        })()`);
        if (!calOpen) {
          console.log(`   ℹ️ Reopening calendar...`);
          await page.evaluate(`(() => {
            const inp = document.getElementById("am-form-field-control-4");
            if (inp) { inp.focus(); inp.click(); }
          })()`);
          await page.waitForTimeout(1500);
          // Navigate to target month if needed
          for (let j = 0; j < 6; j++) {
            const labels = await page.evaluate(`(() => {
              const els = document.querySelectorAll('.ngb-dp-month-name');
              return Array.from(els).filter(e => e.offsetParent !== null).map(e => e.textContent.trim());
            })()`);
            if (labels.some(l => l.includes("${CFG.depMonthName}") && l.includes("${CFG.depYear}"))) break;
            await page.evaluate(`(() => {
              const btns = document.querySelectorAll('.ngb-dp-arrow-btn, button[aria-label="Next month"]');
              for (const b of btns) {
                if ((b.getAttribute('aria-label') || '').toLowerCase().includes('next month')) { b.click(); return; }
              }
            })()`);
            await page.waitForTimeout(800);
          }
        }
        try {
          const dayActions = await stagehand.observe(`Click on the day ${CFG.depDay} in the ${CFG.depMonthName} ${CFG.depYear} calendar`);
          if (dayActions.length > 0) {
            await stagehand.act(dayActions[0]);
            await page.waitForTimeout(1000);
          }
        } catch (e) {
          console.log(`   ⚠️ Date Strategy 2 error: ${e.message}`);
        }
        ds = await page.evaluate(`(() => {
          const inp = document.getElementById("am-form-field-control-4");
          if (!inp) return { value: '', valid: false };
          const cls = inp.className || '';
          return { value: inp.value, valid: cls.includes('ng-valid') && !cls.includes('ng-invalid') };
        })()`);
        console.log(`   📊 After Date Strategy 2: value="${ds.value}" valid=${ds.valid}`);
        if (ds.valid) dateValid = true;
      }

      // ── Date Strategy 3: Full event dispatch (set value even if not ng-valid) ──
      if (!dateValid) {
        console.log(`   🎯 Date Strategy 3: Event dispatch...`);
        // Calendar may have closed, reopen
        const calOpen2 = await page.evaluate(`(() => {
          const ngb = document.querySelector('ngb-datepicker');
          return ngb ? (ngb.offsetParent !== null || ngb.getClientRects().length > 0) : false;
        })()`);
        if (!calOpen2) {
          await page.evaluate(`(() => {
            const inp = document.getElementById("am-form-field-control-4");
            if (inp) { inp.focus(); inp.click(); }
          })()`);
          await page.waitForTimeout(1500);
          for (let j = 0; j < 6; j++) {
            const labels = await page.evaluate(`(() => {
              const els = document.querySelectorAll('.ngb-dp-month-name');
              return Array.from(els).filter(e => e.offsetParent !== null).map(e => e.textContent.trim());
            })()`);
            if (labels.some(l => l.includes("${CFG.depMonthName}") && l.includes("${CFG.depYear}"))) break;
            await page.evaluate(`(() => {
              const btns = document.querySelectorAll('.ngb-dp-arrow-btn, button[aria-label="Next month"]');
              for (const b of btns) {
                if ((b.getAttribute('aria-label') || '').toLowerCase().includes('next month')) { b.click(); return; }
              }
            })()`);
            await page.waitForTimeout(800);
          }
        }
        // Event dispatch on the day element
        await page.evaluate(`(() => {
          const day = "${CFG.depDay}";
          const monthName = "${CFG.depMonthName}";
          const year = "${CFG.depYear}";
          const allDivs = document.querySelectorAll('[aria-label]');
          for (const el of allDivs) {
            const aria = el.getAttribute('aria-label') || '';
            if (aria.includes(monthName + ' ' + day + ', ' + year)) {
              if (el.offsetParent !== null || el.getClientRects().length > 0) {
                const r = el.getBoundingClientRect();
                const evBase = { bubbles: true, cancelable: true, view: window, clientX: r.x+r.width/2, clientY: r.y+r.height/2 };
                el.dispatchEvent(new MouseEvent('mouseover', evBase));
                el.dispatchEvent(new MouseEvent('mouseenter', { ...evBase, bubbles: false }));
                el.dispatchEvent(new PointerEvent('pointerdown', { ...evBase, pointerId: 1 }));
                el.dispatchEvent(new MouseEvent('mousedown', { ...evBase, button: 0 }));
                el.dispatchEvent(new PointerEvent('pointerup', { ...evBase, pointerId: 1 }));
                el.dispatchEvent(new MouseEvent('mouseup', { ...evBase, button: 0 }));
                el.dispatchEvent(new MouseEvent('click', { ...evBase, button: 0 }));
                el.click();
                return;
              }
            }
          }
        })()`);
        await page.waitForTimeout(1000);
        ds = await page.evaluate(`(() => {
          const inp = document.getElementById("am-form-field-control-4");
          if (!inp) return { value: '', valid: false };
          const cls = inp.className || '';
          return { value: inp.value, valid: cls.includes('ng-valid') && !cls.includes('ng-invalid') };
        })()`);
        console.log(`   📊 After Date Strategy 3: value="${ds.value}" valid=${ds.valid}`);
        if (ds.valid) dateValid = true;
      }

      console.log(`   ${dateValid ? '✅' : '⚠️'} Date ${dateValid ? 'valid' : 'set but ng-invalid'}: "${ds.value}"`);
      dateSet = true;
    } else {
      console.log(`   ⚠️ Day ${CFG.depDay} not found in calendar — dumping visible day cells...`);
      const dayDump = await page.evaluate(`(() => {
        const cells = document.querySelectorAll('[aria-label*="${CFG.depMonthName}"], [role="gridcell"]');
        const result = [];
        let count = 0;
        for (const c of cells) {
          if (count >= 15) break;
          if (c.offsetParent !== null || c.getClientRects().length > 0) {
            const r = c.getBoundingClientRect();
            if (r.y > 0 && r.y < 600 && r.width > 5) {
              result.push({ text: c.textContent.trim().substring(0, 30), aria: c.getAttribute('aria-label'), tag: c.tagName });
              count++;
            }
          }
        }
        return { total: cells.length, visible: result };
      })()`);
      console.log(`   📊 Day dump: total=${dayDump.total}`, JSON.stringify(dayDump.visible, null, 2));
    }
  }

  // === Fallback: direct typing if calendar approach didn't work ===
  if (!dateSet) {
    console.log("   ℹ️ Calendar date selection didn't work — typing date directly...");
    await page.keyPress("Escape");
    await page.waitForTimeout(500);

    // Re-focus the date field and clear it
    await page.evaluate(`(() => {
      const inp = document.getElementById("am-form-field-control-4");
      if (inp) { inp.focus(); inp.select(); }
    })()`);
    await page.waitForTimeout(300);
    await page.keyPress("Ctrl+a");
    await page.waitForTimeout(100);
    await page.keyPress("Backspace");
    await page.waitForTimeout(200);
    await page.type(CFG.depDisplay, { delay: 40 });
    console.log(`   📊 Typed: ${CFG.depDisplay}`);
    await page.waitForTimeout(300);

    // Check value
    const dateCheck = await page.evaluate(`(() => {
      const inp = document.getElementById("am-form-field-control-4");
      return inp ? { value: inp.value, activeId: (document.activeElement || {}).id } : null;
    })()`);
    console.log(`   📊 Date after typing: value="${dateCheck ? dateCheck.value : 'N/A'}" active=#${dateCheck ? dateCheck.activeId : 'N/A'}`);

    if (!dateCheck || !dateCheck.value || dateCheck.value.length < 6) {
      console.log("   ℹ️ Typing didn't work — injecting via JS...");
      await page.evaluate(`(() => {
        const inp = document.getElementById("am-form-field-control-4");
        if (!inp) return false;
        inp.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(inp, "${CFG.depDisplay}");
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      })()`);
      await page.waitForTimeout(500);
      console.log(`   📊 After injection: "${await page.evaluate('(document.getElementById("am-form-field-control-4") || {}).value')}"`);
    }

    // Tab out and Escape to commit
    await page.keyPress("Tab");
    await page.waitForTimeout(300);
    await page.keyPress("Escape");
    await page.waitForTimeout(300);
  }

  await page.waitForTimeout(1000);
  recorder.record("act", { instruction: `Set date to ${CFG.depDisplay}` });
}

// ── Step 5: Click Search ────────────────────────────────────────────────────
async function clickSearch(stagehand, page, recorder) {
  console.log("🎯 STEP 4: Search...");
  await scrollToTop(page);
  await page.waitForTimeout(500);

  // Detailed Angular form validation diagnostic
  const formDiag = await page.evaluate(`(() => {
    const from = document.getElementById("am-form-field-control-0");
    const to = document.getElementById("am-form-field-control-2");
    const date = document.getElementById("am-form-field-control-4");

    function getState(el) {
      if (!el) return { exists: false };
      const cls = el.className || '';
      return {
        value: (el.value || '').substring(0, 60),
        valid: cls.includes('ng-valid'),
        invalid: cls.includes('ng-invalid'),
        pristine: cls.includes('ng-pristine'),
        dirty: cls.includes('ng-dirty'),
        touched: cls.includes('ng-touched'),
        untouched: cls.includes('ng-untouched'),
        cls: cls.substring(0, 120),
      };
    }

    // Check form-level state
    const forms = document.querySelectorAll('form, [ngForm], [formGroup]');
    const formStates = [];
    for (const f of forms) {
      const cls = f.className || '';
      if (cls.includes('ng-')) {
        formStates.push({
          tag: f.tagName, id: f.id || '',
          valid: cls.includes('ng-valid'),
          invalid: cls.includes('ng-invalid'),
          cls: cls.substring(0, 120),
        });
      }
    }

    // Check all ng-invalid elements for clues
    const invalidEls = document.querySelectorAll('.ng-invalid');
    const invalidList = [];
    for (const el of invalidEls) {
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        invalidList.push({
          tag: el.tagName, id: el.id || '', name: el.name || '',
          ph: el.placeholder || '', value: (el.value || '').substring(0, 40),
        });
      }
    }

    return {
      from: getState(from),
      to: getState(to),
      date: getState(date),
      forms: formStates,
      invalidInputs: invalidList,
    };
  })()`);
  console.log(`   📊 Angular form diagnostic:`, JSON.stringify(formDiag, null, 2));

  // Verify all fields are filled
  const fieldCheck = await page.evaluate(`(() => {
    const from = document.getElementById("am-form-field-control-0");
    const to = document.getElementById("am-form-field-control-2");
    const date = document.getElementById("am-form-field-control-4");
    return {
      from: from ? from.value : 'N/A',
      to: to ? to.value : 'N/A',
      date: date ? date.value : 'N/A',
    };
  })()`);
  console.log(`   📊 Field values: From="${fieldCheck.from}" To="${fieldCheck.to}" Date="${fieldCheck.date}"`);

  // Detailed button diagnostic
  const btnInfo = await page.evaluate(`(() => {
    const btns = document.querySelectorAll('button, a, input[type="submit"]');
    const candidates = [];
    for (const b of btns) {
      const text = (b.textContent || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
      if (text.includes('find trains') || text === 'search' || text === 'find') {
        const r = b.getBoundingClientRect();
        candidates.push({
          text: text.substring(0, 60),
          tag: b.tagName,
          type: b.type || '',
          disabled: b.disabled || false,
          ariaDisabled: b.getAttribute('aria-disabled'),
          cls: b.className.substring(0, 80),
          x: r.x + r.width/2,
          y: r.y + r.height/2,
          w: r.width,
          h: r.height,
          vis: (b.offsetParent !== null || b.getClientRects().length > 0),
          form: b.form ? b.form.id || b.form.action || 'has-form' : 'no-form',
        });
      }
    }
    // Also check for Angular form errors
    const errors = document.querySelectorAll('.mat-error, .error, [class*="error"], [class*="invalid"]');
    const visErrors = [];
    for (const e of errors) {
      if (e.offsetParent !== null && e.textContent.trim().length > 0)
        visErrors.push(e.textContent.trim().substring(0, 80));
    }
    return { candidates, errors: visErrors };
  })()`);
  console.log(`   📊 Button candidates:`, JSON.stringify(btnInfo.candidates, null, 2));
  if (btnInfo.errors.length > 0) console.log(`   ⚠️ Form errors:`, btnInfo.errors);

  // Strategy 1: Force-enable the button, then programmatic DOM click
  const progClick = await page.evaluate(`(() => {
    const btns = document.querySelectorAll('button, a, input[type="submit"]');
    for (const b of btns) {
      const text = (b.textContent || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
      if (text.includes('find trains')) {
        if (b.offsetParent !== null || b.getClientRects().length > 0) {
          const r = b.getBoundingClientRect();
          if (r.width > 30 && r.height > 15 && r.y > 0 && r.y < 800) {
            // Force-enable if disabled
            if (b.disabled) b.disabled = false;
            b.removeAttribute('disabled');
            b.classList.remove('disabled');
            b.click();
            return { text: text.substring(0, 40), method: 'programmatic', wasDisabled: true };
          }
        }
      }
    }
    return null;
  })()`);
  if (progClick) {
    console.log(`   ✅ Programmatic click: "${progClick.text}" (wasDisabled: ${progClick.wasDisabled})`);
  }

  // Wait and check if URL changed
  await page.waitForTimeout(3000);
  let url = page.url();
  console.log(`   📍 URL after programmatic click: ${url}`);

  // Strategy 2: If still on home, try coordinate click
  if (url.includes('/home') || url === 'https://www.amtrak.com/') {
    console.log("   ℹ️ Still on home — trying coordinate click...");
    if (btnInfo.candidates.length > 0) {
      const c = btnInfo.candidates[0];
      await page.click(c.x, c.y);
      console.log(`   ✅ Coordinate click at (${c.x}, ${c.y})`);
      await page.waitForTimeout(3000);
      url = page.url();
      console.log(`   📍 URL after coordinate click: ${url}`);
    }
  }

  // Strategy 3: If still on home, try form submit
  if (url.includes('/home') || url === 'https://www.amtrak.com/') {
    console.log("   ℹ️ Still on home — trying form submit...");
    await page.evaluate(`(() => {
      const forms = document.querySelectorAll('form');
      for (const f of forms) {
        const btn = f.querySelector('button');
        if (btn && (btn.textContent || '').toLowerCase().includes('find')) {
          f.submit();
          return 'submitted';
        }
      }
      // Also try clicking submit via Angular's form handler  
      const btns = document.querySelectorAll('button[type="submit"]');
      for (const b of btns) { b.click(); }
      return 'fallback';
    })()`);
    await page.waitForTimeout(3000);
    url = page.url();
    console.log(`   📍 URL after form submit: ${url}`);
  }

  // Strategy 4: Try stagehand AI act
  if (url.includes('/home') || url === 'https://www.amtrak.com/') {
    console.log("   ℹ️ Still on home — trying AI act...");
    await stagehand.act("Click the FIND TRAINS button to search for trains");
    await page.waitForTimeout(5000);
    url = page.url();
    console.log(`   📍 URL after AI act: ${url}`);
  }

  // Strategy 5: Direct URL navigation as ultimate fallback
  if (url.includes('/home') || url === 'https://www.amtrak.com/') {
    console.log("   ℹ️ All button strategies failed — navigating directly to search URL...");
    // Amtrak search URL format (determined by inspecting their routing)
    const searchUrl = `https://www.amtrak.com/tickets/departure.html`
      + `?journeyOrigin=SEA&journeyDestination=PDX`
      + `&departDate=${CFG.depYear}-${String(CFG.depMonth).padStart(2,'0')}-${String(CFG.depDay).padStart(2,'0')}`
      + `&adults=1&children=0&seniors=0&type=one-way`;
    console.log(`   🔗 Navigating to: ${searchUrl}`);
    await page.goto(searchUrl);
    await page.waitForTimeout(8000);
    try { await page.waitForLoadState("domcontentloaded"); } catch(e) {}
    url = page.url();
    console.log(`   📍 URL after direct nav: ${url}`);
  }

  // Strategy 6: Use Stagehand Agent to fill form and search (nuclear option)
  if (url.includes('/home') || url === 'https://www.amtrak.com/') {
    console.log("   ℹ️ All strategies failed — using Stagehand Agent to perform search...");
    try {
      await page.goto("https://www.amtrak.com");
      await page.waitForTimeout(5000);
      const agent = stagehand.agent({
        model: "openai/gpt-4.1-mini",
      });
      const result = await agent.execute({
        instruction: `On the Amtrak booking form:
1. Click "One-Way"
2. In the From field, type "Seattle, WA" and select "Seattle, WA - King Street Station (SEA)" from the dropdown
3. In the To field, type "Portland, OR" and select "Portland, OR - Union Station (PDX)" from the dropdown
4. Click the Depart Date field, navigate the calendar to April 2026, and click day 27
5. Click the "FIND TRAINS" button`,
        maxSteps: 25,
      });
      console.log(`   📍 Agent result: ${result.message}`);
      await page.waitForTimeout(5000);
      url = page.url();
      console.log(`   📍 URL after agent: ${url}`);
    } catch (e) {
      console.log(`   ⚠️ Agent failed: ${e.message}`);
    }
  }

  // Final wait
  console.log("   ⏳ Waiting for results page...");
  await page.waitForTimeout(CFG.waits.search);
  try { await page.waitForLoadState("domcontentloaded"); } catch(e) {}
  await page.waitForTimeout(3000);
  console.log(`   📍 Final URL: ${page.url()}`);
  recorder.record("act", { instruction: "Click FIND TRAINS" });
}

// ── Step 6: Extract trains ──────────────────────────────────────────────────
async function extractTrains(stagehand, page, recorder) {
  console.log(`🎯 STEP 5: Extract up to ${CFG.maxResults} trains...\n`);

  // Scroll to load content
  for (let i = 0; i < 5; i++) {
    await page.evaluate("window.scrollBy(0, 400)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // Print page text for debug
  const bodyText = await page.evaluate("document.body.innerText.substring(0, 4000)");
  console.log("   📝 Page text (first 2500 chars):\n" + bodyText.substring(0, 2500));
  console.log("   ...\n");

  // DOM extraction
  const domResult = await page.evaluate(`((maxResults) => {
    const results = [];
    const seen = new Set();

    // Find card/row containers that have time-like data
    const selectors = [
      '[class*="result" i]', '[class*="journey" i]', '[class*="trip" i]',
      '[class*="train" i]', '[class*="fare" i]', '[class*="option" i]',
      '[data-testid*="result"]', '[data-testid*="train"]',
      'tr', '[role="row"]', '.card', 'article',
    ];
    let cards = [];
    let usedSel = '';
    for (const sel of selectors) {
      try {
        const c = Array.from(document.querySelectorAll(sel)).filter(el => {
          const t = (el.textContent || '');
          return /\\d{1,2}:\\d{2}/.test(t) && t.length > 20 && t.length < 3000;
        });
        if (c.length >= 1 && c.length <= 30) { cards = c; usedSel = sel; break; }
      } catch(e) {}
    }

    for (const card of cards.slice(0, maxResults * 3)) {
      const text = (card.textContent || '').replace(/\\s+/g, ' ').trim();
      if (text.length < 15) continue;

      const times = text.match(/\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm)/gi);
      let dep = 'N/A', arr = 'N/A';
      if (times && times.length >= 2) { dep = times[0].trim(); arr = times[1].trim(); }
      else if (times && times.length === 1) dep = times[0].trim();

      let dur = 'N/A';
      const dm = text.match(/(\\d+)\\s*(?:h|hr)\\s*(\\d+)?\\s*(?:m|min)?/i);
      if (dm) dur = dm[1] + 'h' + (dm[2] ? ' ' + dm[2] + 'm' : '');

      let price = 'N/A';
      const pm = text.match(/\\$(\\d[\\d,]*)/);
      if (pm) price = '$' + pm[1];

      if (dep === 'N/A' && price === 'N/A') continue;
      const key = dep + '-' + arr;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ departure: dep, arrival: arr, duration: dur, price });
      if (results.length >= maxResults) break;
    }
    return { trains: results, cardCount: cards.length, selector: usedSel };
  })(${CFG.maxResults})`);

  console.log(`   📊 DOM: ${domResult.trains.length} trains (${domResult.cardCount} cards, sel="${domResult.selector}")`);

  let trains;
  if (domResult.trains.length > 0) {
    trains = { trains: domResult.trains };
  } else {
    // Body text fallback — look for lines with times and prices
    console.log("   📝 Trying body text fallback...");
    const bodyTrains = await page.evaluate(`((maxResults) => {
      const text = document.body.innerText || '';
      const lines = text.split('\\n');
      const results = [];
      for (const line of lines) {
        const times = line.match(/\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm)/gi);
        const pm = line.match(/\\$(\\d[\\d,]*)/);
        if (times && times.length >= 2 && pm) {
          results.push({ departure: times[0].trim(), arrival: times[1].trim(), duration: 'N/A', price: '$' + pm[1] });
          if (results.length >= maxResults) break;
        }
      }
      return results;
    })(${CFG.maxResults})`);

    if (bodyTrains.length > 0) {
      trains = { trains: bodyTrains };
      console.log(`   📊 Body: ${bodyTrains.length} trains`);
    } else {
      // AI fallback
      console.log("   🤖 AI extraction...");
      const { z } = require("zod/v3");
      trains = await stagehand.extract(
        `Extract up to ${CFG.maxResults} available train options from this page. For each: departure time, arrival time, duration, and price.`,
        z.object({
          trains: z.array(z.object({
            departure: z.string(), arrival: z.string(), duration: z.string(), price: z.string(),
          })),
        })
      );
    }
  }

  recorder.record("extract", { instruction: "Extract trains", results: trains });
  console.log(`\n📋 Found ${trains.trains.length} trains:`);
  trains.trains.forEach((t, i) => {
    console.log(`   ${i + 1}. Depart: ${t.departure}  Arrive: ${t.arrival}  Duration: ${t.duration}  💰 ${t.price}`);
  });
  return trains;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Amtrak – Train Ticket Search (One-Way)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🚆 ${CFG.from} → ${CFG.to}`);
  console.log(`  📅 Departure: ${CFG.depDisplay}  (1 adult, one-way)\n`);

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");
  let stagehand;

  try {
    console.log("🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL", verbose: 0, llmClient,
      localBrowserLaunchOptions: {
        userDataDir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
        headless: false,
        viewport: { width: 1920, height: 1080 },
        args: ["--disable-blink-features=AutomationControlled", "--disable-infobars",
               "--disable-extensions", "--start-maximized", "--window-size=1920,1080"],
      },
    });
    await stagehand.init();
    console.log("✅ Stagehand ready\n");
    const page = stagehand.context.pages()[0];

    // Navigate
    console.log("🌐 Loading Amtrak...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    recorder.wait(CFG.waits.page, "Initial load");
    await page.waitForTimeout(CFG.waits.page);
    console.log("✅ Loaded\n");

    // Install API interceptor to capture Amtrak's network requests
    await page.evaluate(`(() => {
      window.__apiLog = [];
      const origFetch = window.fetch;
      window.fetch = function() {
        const url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
        const opts = arguments[1] || {};
        window.__apiLog.push({ t: 'fetch', url: url.substring(0, 300), m: opts.method || 'GET', body: opts.body ? String(opts.body).substring(0, 200) : null });
        return origFetch.apply(this, arguments);
      };
      const origXHR = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        window.__apiLog.push({ t: 'xhr', url: (url||'').substring(0, 300), m: method });
        return origXHR.apply(this, arguments);
      };
    })()`).catch(() => {});
    console.log("📡 API interceptor installed\n");

    // Dump initial inputs for reference
    await dumpInputs(page);

    await dismissPopups(page);
    await selectOneWay(stagehand, page, recorder);
    await enterStation(stagehand, page, recorder, "origin", CFG.from, CFG.fromKeyword);
    await enterStation(stagehand, page, recorder, "destination", CFG.to, CFG.toKeyword);
    await setDate(stagehand, page, recorder);

    // ── Validation gate: check if Angular form is valid ──
    const preSearchCheck = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button');
      let findTrainsDisabled = null;
      for (const b of btns) {
        if ((b.textContent || '').toLowerCase().includes('find trains') && b.offsetParent !== null) {
          findTrainsDisabled = b.disabled;
          break;
        }
      }
      const from = document.getElementById("am-form-field-control-0");
      const to = document.getElementById("am-form-field-control-2");
      const date = document.getElementById("am-form-field-control-4");
      const fromInvalid = from && (from.className || '').includes('ng-invalid');
      const toInvalid = to && (to.className || '').includes('ng-invalid');
      const dateInvalid = date && (date.className || '').includes('ng-invalid');
      return { findTrainsDisabled, fromInvalid, toInvalid, dateInvalid,
        fromVal: from ? from.value : '', toVal: to ? to.value : '', dateVal: date ? date.value : '' };
    })()`);
    console.log(`\n🔍 Pre-search validation:`, JSON.stringify(preSearchCheck));

    // Dump ALL captured API calls for debugging
    const allApiCalls = await page.evaluate(`(window.__apiLog || []).slice(0, 30)`);
    console.log(`📡 Captured ${allApiCalls.length} API calls total:`);
    for (const c of allApiCalls.slice(0, 15)) {
      console.log(`   ${c.m} ${c.url}${c.body ? ' body=' + c.body : ''}`);
    }

    if (preSearchCheck.findTrainsDisabled) {
      console.log("⚠️ FIND TRAINS still disabled — Angular form invalid. Retrying with stagehand.act()...\n");
      
      // Reload page to start fresh
      await page.goto("https://www.amtrak.com");
      await page.waitForTimeout(5000);
      try { await page.waitForLoadState("domcontentloaded"); } catch(e) {}
      await page.waitForTimeout(3000);
      await dismissPopups(page);
      
      // One-Way (act already worked for this)
      console.log("🎯 [ACT] Select One-Way...");
      await stagehand.act("Click the 'One-Way' button in the booking form header");
      await page.waitForTimeout(1500);
      
      // From station
      console.log("🎯 [ACT] Enter From station...");
      await stagehand.act("Click on the 'From' input field in the booking form");
      await page.waitForTimeout(500);
      await stagehand.act("Type 'Seattle' in the From input field");
      await page.waitForTimeout(2000);
      await stagehand.act("Select 'Seattle, WA - King Street Station (SEA)' from the autocomplete dropdown");
      await page.waitForTimeout(1500);
      
      // To station
      console.log("🎯 [ACT] Enter To station...");
      await stagehand.act("Click on the 'To' input field in the booking form");
      await page.waitForTimeout(500);
      await stagehand.act("Type 'Portland' in the To input field");
      await page.waitForTimeout(2000);
      await stagehand.act("Select 'Portland, OR - Union Station (PDX)' from the autocomplete dropdown");
      await page.waitForTimeout(1500);
      
      // Date
      console.log("🎯 [ACT] Set departure date...");
      await stagehand.act("Click on the 'Depart Date' input field");
      await page.waitForTimeout(1500);
      // Navigate months
      for (let i = 0; i < 2; i++) {
        await stagehand.act("Click the 'Next month' arrow button in the calendar datepicker");
        await page.waitForTimeout(800);
      }
      await stagehand.act("Click on day 27 in April 2026 in the calendar");
      await page.waitForTimeout(1000);
      
      // Check validation again
      const recheck = await page.evaluate(`(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if ((b.textContent || '').toLowerCase().includes('find trains') && b.offsetParent !== null) {
            return { disabled: b.disabled };
          }
        }
        return { disabled: 'not found' };
      })()`);
      console.log(`🔍 After act() retry: FIND TRAINS disabled=${recheck.disabled}`);
    }

    await clickSearch(stagehand, page, recorder);
    const trains = await extractTrains(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${trains.trains.length} trains`);
    console.log("═══════════════════════════════════════════════════════════");
    trains.trains.forEach((t, i) => {
      console.log(`  ${i+1}. Depart: ${t.departure}  Arrive: ${t.arrival}  Duration: ${t.duration}  💰 ${t.price}`);
    });

    // Save
    fs.writeFileSync(path.join(__dirname, "amtrak_search.py"), genPython(CFG), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"),
      JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log("📋 Actions saved");

    return trains;
  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      fs.writeFileSync(path.join(__dirname, "amtrak_search.py"), genPython(CFG), "utf-8");
      console.log("⚠️  Partial Python saved");
    }
    throw err;
  } finally {
    if (stagehand) { console.log("🧹 Closing..."); await stagehand.close(); }
  }
}

if (require.main === module) {
  main().then(() => { console.log("🎊 Done!"); process.exit(0); })
    .catch(e => { console.error("💥", e.message); process.exit(1); });
}
module.exports = { main };
