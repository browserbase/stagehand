// v3 ONLY — v4 switches languages with native <Tabs>. Mintlify injects every
// root-level .js on every page, and the version switcher moves between v3 and v4
// client-side, so a single guard at load would be wrong in both directions. Each
// entry point checks isV3Page() instead. No DOM test environment here; verify by
// hand in `mint dev` after changing this.

(function () {
  const DROPDOWN_LANGUAGES = ["TypeScript", "Python", "Java", "Go", "Ruby"];

  const LANGUAGE_MAP = {
    TypeScript: "Javascript",
    Python: "Python",
    Java: "Java",
    Go: "Go",
    Ruby: "Ruby",
  };

  const CODE_BLOCK_LANGUAGES = ["Javascript", "Python", "Go", "Java", "Ruby", "cURL", "PHP"];

  const SDK_PATH_MAP = {
    Python: "python",
    Java: "java",
    Go: "go",
    Ruby: "ruby",
  };

  const NAVIGATION_MAP = {
    TypeScript: "/v3/first-steps/introduction",
    Python: "/v3/sdk/python",
    Java: "/v3/sdk/java",
    Go: "/v3/sdk/go",
    Ruby: "/v3/sdk/ruby",
  };

  let currentSelectedLanguage = "TypeScript";
  let isSelecting = false;

  const isV3Page = () => window.location.pathname.startsWith("/v3");

  function resetState() {
    isSelecting = false;
    document.body.classList.remove("stagehand-selecting", "stagehand-hide-version-switcher");
  }

  const onNextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  const dropdownStyle = document.createElement("style");
  dropdownStyle.id = "stagehand-language-style";
  dropdownStyle.textContent = `
    /* Hide dropdown during programmatic selection */
    .stagehand-selecting [role="menu"],
    .stagehand-selecting [role="listbox"] {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: none !important;
    }
    
    /* Hide version switcher when non-TypeScript language is selected */
    .stagehand-hide-version-switcher .stagehand-version-switcher {
      display: none !important;
    }
    
    /* Hide SDK reference items that don't match the selected language */
    li[id^="/v3/sdk/"].stagehand-sdk-hidden {
      display: none !important;
    }
  `;
  document.head.appendChild(dropdownStyle);

  function updateSDKReferenceVisibility() {
    const currentSDKPath = SDK_PATH_MAP[currentSelectedLanguage];

    const sdkItems = document.querySelectorAll('li[id^="/v3/sdk/"]');

    sdkItems.forEach((item) => {
      const itemId = item.getAttribute("id") || "";
      const itemLang = itemId.split("/").pop();

      if (currentSelectedLanguage === "TypeScript") {
        item.classList.add("stagehand-sdk-hidden");
      } else if (currentSDKPath && itemLang === currentSDKPath) {
        item.classList.remove("stagehand-sdk-hidden");
      } else {
        item.classList.add("stagehand-sdk-hidden");
      }
    });
  }

  function getVersionSwitcher() {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = (btn.textContent || "").trim().toLowerCase();
      if (/^v\d+$/.test(text) && btn.querySelector(".lucide-chevron-down")) {
        return btn;
      }
    }
    return null;
  }

  function updateVersionSwitcherVisibility() {
    const versionSwitcher = getVersionSwitcher();

    if (versionSwitcher) {
      versionSwitcher.classList.add("stagehand-version-switcher");

      if (currentSelectedLanguage === "TypeScript") {
        document.body.classList.remove("stagehand-hide-version-switcher");
      } else {
        document.body.classList.add("stagehand-hide-version-switcher");
      }
    }
  }

  function getDropdownButton() {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = (btn.textContent || "").trim();
      if (DROPDOWN_LANGUAGES.includes(text)) {
        return btn;
      }
    }
    return null;
  }

  function getDropdownMenu() {
    return document.querySelector('menu[role="menu"], [role="menu"]');
  }

  function updateButtonText(newText) {
    const button = getDropdownButton();
    if (!button) return;

    const paragraph = button.querySelector("p");
    if (paragraph) {
      paragraph.textContent = newText;
    }
  }

  function updateDropdownCheckIndicator() {
    const menu = getDropdownMenu();
    if (!menu) return;

    const menuItems = menu.querySelectorAll('a, [role="menuitem"]');
    const checkIconsMap = new Map();
    let anyCheckIcon = null;

    for (const item of menuItems) {
      const text = (item.textContent || "").trim();
      const checkIcon = item.querySelector(
        '.lucide-check, [class*="lucide-check"], svg[class*="check"]',
      );

      for (const lang of DROPDOWN_LANGUAGES) {
        if (text.includes(lang)) {
          checkIconsMap.set(lang, { item, checkIcon });
          if (checkIcon) {
            anyCheckIcon = checkIcon;
          }
          break;
        }
      }
    }

    for (const [lang, { item, checkIcon }] of checkIconsMap) {
      const shouldBeSelected = lang === currentSelectedLanguage;

      if (checkIcon) {
        checkIcon.style.opacity = shouldBeSelected ? "1" : "0";
        checkIcon.style.visibility = shouldBeSelected ? "visible" : "hidden";
      } else if (shouldBeSelected && anyCheckIcon) {
        const clonedCheck = anyCheckIcon.cloneNode(true);
        clonedCheck.style.opacity = "1";
        clonedCheck.style.visibility = "visible";

        const targetSpan = item.querySelector("span:last-child") || item;
        if (targetSpan.querySelector('.lucide-check, [class*="lucide-check"]') === null) {
          targetSpan.appendChild(clonedCheck);
        }
      }
    }
  }

  function simulateClick(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((eventType) => {
      const EventClass = eventType.startsWith("pointer") ? PointerEvent : MouseEvent;
      element.dispatchEvent(
        new EventClass(eventType, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
          isPrimary: true,
          pointerType: "mouse",
        }),
      );
    });
  }

  function getCodeBlockLanguageDropdown() {
    const paragraphs = document.querySelectorAll("p");

    for (const p of paragraphs) {
      const text = (p.textContent || "").trim();
      if (CODE_BLOCK_LANGUAGES.includes(text)) {
        const parentDiv = p.closest("div");
        if (parentDiv && parentDiv.querySelector(".lucide-chevrons-up-down")) {
          return { element: parentDiv, language: text };
        }
      }
    }
    return null;
  }

  function waitForCodeBlockMenuAndSelect(targetLanguage, attempts = 0) {
    if (!isV3Page()) {
      resetState();
      return;
    }

    if (attempts > 30) {
      document.body.classList.remove("stagehand-selecting");
      document.body.click();
      isSelecting = false;
      return;
    }

    const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');

    if (menuItems.length === 0) {
      requestAnimationFrame(() => waitForCodeBlockMenuAndSelect(targetLanguage, attempts + 1));
      return;
    }

    for (const item of menuItems) {
      const text = (item.textContent || "").trim();
      if (text === targetLanguage) {
        simulateClick(item);
        onNextFrame(() => {
          document.body.classList.remove("stagehand-selecting");
          isSelecting = false;
        });
        return;
      }
    }

    requestAnimationFrame(() => waitForCodeBlockMenuAndSelect(targetLanguage, attempts + 1));
  }

  function selectCodeBlockLanguage(targetLanguage) {
    if (!isV3Page()) return;
    if (isSelecting) return;

    const current = getCodeBlockLanguageDropdown();
    if (!current) return;
    if (current.language === targetLanguage) return;

    isSelecting = true;
    document.body.classList.add("stagehand-selecting");
    simulateClick(current.element);
    requestAnimationFrame(() => waitForCodeBlockMenuAndSelect(targetLanguage));
  }

  function syncCodeBlockLanguage() {
    const codeBlockLang = LANGUAGE_MAP[currentSelectedLanguage];
    if (codeBlockLang) {
      selectCodeBlockLanguage(codeBlockLang);
    }
  }

  function setupDropdownMenuObserver() {
    const menuObserver = new MutationObserver(() => {
      if (!isV3Page()) return;
      const menu = getDropdownMenu();
      if (menu) {
        updateDropdownCheckIndicator();
        onNextFrame(updateDropdownCheckIndicator);
      }
    });

    menuObserver.observe(document.body, {
      subtree: true,
      childList: true,
    });
  }

  function setupMenuClickHandler() {
    document.addEventListener(
      "click",
      (e) => {
        if (!isV3Page()) return;
        const target = e.target;

        const menuItem = target.closest('[role="menu"] a, menu a');
        if (!menuItem) return;

        const text = (menuItem.textContent || "").trim();

        for (const lang of DROPDOWN_LANGUAGES) {
          if (text.includes(lang)) {
            currentSelectedLanguage = lang;

            updateDropdownCheckIndicator();

            updateVersionSwitcherVisibility();

            updateSDKReferenceVisibility();

            try {
              sessionStorage.setItem("stagehand-selected-language", lang);
            } catch (err) {}

            const targetPath = NAVIGATION_MAP[lang];
            const normalizedPathname = window.location.pathname.replace(/\/$/, "");
            if (targetPath && !normalizedPathname.endsWith(targetPath)) {
              e.preventDefault();
              e.stopPropagation();
              window.location.href = targetPath;
              return;
            }

            onNextFrame(() => updateButtonText(lang));

            onNextFrame(syncCodeBlockLanguage);

            break;
          }
        }
      },
      true,
    );
  }

  function restoreLanguageSelection() {
    if (!isV3Page()) return;
    try {
      const stored = sessionStorage.getItem("stagehand-selected-language");
      if (stored && DROPDOWN_LANGUAGES.includes(stored)) {
        currentSelectedLanguage = stored;
        updateButtonText(stored);
        updateVersionSwitcherVisibility();
        updateSDKReferenceVisibility();
        onNextFrame(syncCodeBlockLanguage);
      }
    } catch (err) {}

    onNextFrame(() => {
      updateVersionSwitcherVisibility();
      updateSDKReferenceVisibility();
    });
  }

  function setupPageChangeObserver() {
    let sdkUpdatePending = false;

    const observer = new MutationObserver(() => {
      if (!isV3Page()) return;
      const button = getDropdownButton();
      if (button) {
        const currentText = (button.textContent || "").trim();
        if (
          currentText !== currentSelectedLanguage &&
          DROPDOWN_LANGUAGES.includes(currentSelectedLanguage)
        ) {
          updateButtonText(currentSelectedLanguage);
        }
      }

      const versionSwitcher = getVersionSwitcher();
      if (versionSwitcher && !versionSwitcher.classList.contains("stagehand-version-switcher")) {
        updateVersionSwitcherVisibility();
      }

      const sdkItems = document.querySelectorAll(
        'li[id^="/v3/sdk/"]:not(.stagehand-sdk-processed)',
      );
      if (sdkItems.length > 0 && !sdkUpdatePending) {
        sdkUpdatePending = true;
        onNextFrame(() => {
          updateSDKReferenceVisibility();
          document.querySelectorAll('li[id^="/v3/sdk/"]').forEach((item) => {
            item.classList.add("stagehand-sdk-processed");
          });
          sdkUpdatePending = false;
        });
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
    });
  }

  function setupCodeBlockObserver() {
    let lastCodeBlockDropdown = null;

    const observer = new MutationObserver(() => {
      if (!isV3Page()) return;
      const dropdown = getCodeBlockLanguageDropdown();
      if (dropdown && dropdown.element !== lastCodeBlockDropdown) {
        lastCodeBlockDropdown = dropdown.element;

        const targetLang = LANGUAGE_MAP[currentSelectedLanguage];
        if (targetLang && dropdown.language !== targetLang) {
          onNextFrame(() => selectCodeBlockLanguage(targetLang));
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
    });
  }

  function init() {
    setupMenuClickHandler();
    setupDropdownMenuObserver();
    setupPageChangeObserver();
    setupCodeBlockObserver();

    applyForCurrentPage();
  }

  function applyForCurrentPage() {
    if (!isV3Page()) {
      resetState();
      return;
    }
    restoreLanguageSelection();
    updateVersionSwitcherVisibility();
    updateSDKReferenceVisibility();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      document.querySelectorAll('li[id^="/v3/sdk/"].stagehand-sdk-processed').forEach((item) => {
        item.classList.remove("stagehand-sdk-processed");
      });
      onNextFrame(() => {
        applyForCurrentPage();
        syncCodeBlockLanguage();
      });
    }
  });
  urlObserver.observe(document.body, { subtree: true, childList: true });
})();
