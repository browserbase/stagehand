// Version switcher for Stagehand docs
//
// Mintlify's maple theme renders the version selector as a small collapsed
// control at the bottom of the sidebar, where nobody finds it. This hides that
// control on desktop and renders a prominent dropdown at the top of the sidebar
// instead — the placement the old willow-theme docs used — styled to match the
// v3 language dropdown (nav-dropdown-trigger / nav-dropdown-content).
//
// Mintlify injects every root-level .js on every page, and readers move between
// versions client-side, so everything re-checks the DOM instead of assuming
// page state at load. No DOM test environment here; verify by hand in
// `mint dev` after changing this.

(function () {
  // ============================================
  // CONFIGURATION
  // ============================================

  // Mirrors the targets of Mintlify's native version select: the first page of
  // each version in docs.json. Update when versions change.
  const VERSIONS = [
    { label: "v4", href: "/v4/first-steps/introduction" },
    { label: "v3", href: "/v3/first-steps/introduction" },
    { label: "v2", href: "/v2/first-steps/introduction" },
  ];

  const currentVersion = () => {
    const match = window.location.pathname.match(/^\/(v\d+)(\/|$)/);
    return match ? match[1] : VERSIONS[0].label;
  };

  // ============================================
  // STYLES
  // ============================================

  const style = document.createElement("style");
  style.id = "stagehand-version-switcher-style";
  style.textContent = `
    /* Hide the native bottom-of-sidebar version select; the top dropdown replaces it */
    nav li:has([data-component-part="version-select-trigger"]) {
      display: none !important;
    }

    .stagehand-version-dropdown {
      position: relative;
    }

    .stagehand-version-menu {
      position: absolute;
      top: calc(100% + 0.25rem);
      left: 0;
      right: 0;
      z-index: 50;
    }

    .stagehand-version-menu[hidden] {
      display: none;
    }

    /* language-selector.js hides the version switcher when a non-TypeScript
       language is selected on v3 pages */
    .stagehand-hide-version-switcher .stagehand-version-dropdown {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  // ============================================
  // MARKUP
  // ============================================

  // Class strings copied from the Mintlify maple language dropdown so the two
  // controls render identically. If a Mintlify update changes them, re-copy
  // from the v3 TypeScript dropdown in devtools.
  const TRIGGER_CLASSES =
    "group disabled:pointer-events-none [&>span]:line-clamp-1 overflow-hidden " +
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary " +
    "dark:focus-visible:outline-primary-light text-sm text-gray-950/50 dark:text-white/50 " +
    "nav-dropdown-trigger z-10 flex w-full items-center pl-2 pr-3.5 py-1.5 " +
    "rounded-[0.85rem] border border-gray-200/70 dark:border-white/[0.07] " +
    "hover:bg-gray-600/5 dark:hover:bg-gray-200/5 gap-1";

  const MENU_CLASSES =
    "outline-none shadow-xl dark:shadow-none shadow-gray-500/5 bg-background-light " +
    "dark:bg-background-dark overflow-y-auto rounded-2xl border-standard " +
    "text-gray-950/70 dark:text-white/70 nav-dropdown-content p-1";

  const ITEM_CLASSES =
    "link nav-dropdown-item rounded-xl text-gray-800 hover:text-gray-900 px-1.5 pr-2.5 " +
    "py-1.5 dark:text-gray-300 dark:hover:text-gray-200 flex group items-center gap-1 " +
    "hover:bg-gray-950/5 dark:hover:bg-white/5";

  const ICON_BOX_CLASSES =
    "nav-dropdown-item-icon size-8 flex items-center justify-center rounded-lg shrink-0 " +
    "border border-gray-200/70 dark:border-white/[0.07]";

  const TITLE_CLASSES = "nav-dropdown-item-title text-base lg:text-sm font-medium";

  const layersIcon = () =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false" class="size-4 text-primary dark:text-primary-light">' +
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>' +
    '<path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>' +
    '<path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>';

  const chevronIcon = () =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
    'class="size-3 transition-transform text-gray-400 group-hover:text-gray-600 ' +
    'dark:text-gray-600 dark:group-hover:text-gray-400 shrink-0 rotate-90 ml-auto">' +
    '<path d="M6.5 2.75L12.75 9L6.5 15.25"/></svg>';

  const checkIcon = () =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false" ' +
    'class="size-4 shrink-0 ml-auto text-primary dark:text-primary-light">' +
    '<path d="M20 6 9 17l-5-5"/></svg>';

  function buildDropdown() {
    const active = currentVersion();

    const container = document.createElement("div");
    // stagehand-version-switcher keeps language-selector.js's visibility CSS working
    container.className = "stagehand-version-dropdown stagehand-version-switcher";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = TRIGGER_CLASSES;
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML =
      `<div class="${ICON_BOX_CLASSES}">${layersIcon()}</div>` +
      `<div class="nav-dropdown-item-text-container flex-1 px-1 flex flex-col grow text-left">` +
      `<p class="${TITLE_CLASSES} text-gray-800 dark:text-gray-300">Version ${active}</p>` +
      `</div>` +
      chevronIcon();

    const menu = document.createElement("div");
    menu.className = `stagehand-version-menu ${MENU_CLASSES}`;
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    menu.innerHTML = VERSIONS.map((version) => {
      const isActive = version.label === active;
      const titleColor = isActive
        ? "text-primary dark:text-primary-light"
        : "text-gray-800 dark:text-gray-300";
      return (
        `<a class="${ITEM_CLASSES}" role="menuitem" href="${version.href}"` +
        (isActive ? ' aria-current="location"' : "") +
        `><div class="nav-dropdown-item-text-container flex-1 px-1 flex flex-col grow text-left">` +
        `<p class="${TITLE_CLASSES} ${titleColor}">${version.label}</p>` +
        `</div>` +
        (isActive ? checkIcon() : "") +
        `</a>`
      );
    }).join("");

    const setOpen = (open) => {
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    };

    trigger.addEventListener("click", () => setOpen(menu.hidden));
    container.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.focus();
      }
    });

    container.appendChild(trigger);
    container.appendChild(menu);
    return container;
  }

  // Close the menu on any click outside the dropdown. Registered once at the
  // document level so per-rebuild listeners don't accumulate.
  document.addEventListener("click", (event) => {
    document.querySelectorAll(".stagehand-version-menu").forEach((menu) => {
      const container = menu.closest(".stagehand-version-dropdown");
      if (container && !container.contains(event.target) && !menu.hidden) {
        menu.hidden = true;
        const trigger = container.querySelector("button");
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      }
    });
  });

  // ============================================
  // PLACEMENT
  // ============================================

  // The top-of-sidebar slot: the flex column that holds the sidebar search box
  // (and, on v3 pages, the language dropdown). The dropdown goes directly under
  // the search box.
  function ensureDropdown() {
    const search = document.getElementById("search-bar-entry");
    if (!search || !search.closest("nav")) return;
    const searchWrapper = search.parentElement;
    const slot = searchWrapper && searchWrapper.parentElement;
    if (!slot) return;

    const existing = slot.querySelector(".stagehand-version-dropdown");
    if (existing) {
      // Client-side navigation changed the version; rebuild with the new state
      const label = existing.querySelector("p");
      if (label && label.textContent === `Version ${currentVersion()}`) return;
      existing.remove();
    }

    searchWrapper.insertAdjacentElement("afterend", buildDropdown());
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    ensureDropdown();

    // Re-insert after client-side navigation or sidebar re-renders
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        ensureDropdown();
      });
    });
    observer.observe(document.body, { subtree: true, childList: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
