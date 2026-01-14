// Language switcher for Stagehand docs
// Handles: 1) Sidebar language dropdown selection 2) Code block language syncing

(function() {
  // ============================================
  // CONFIGURATION
  // ============================================
  
  // Sidebar dropdown language options
  const DROPDOWN_LANGUAGES = ['TypeScript', 'Python', 'Java', 'Go', 'Ruby'];
  
  // Map sidebar dropdown names to code block language names
  const LANGUAGE_MAP = {
    'TypeScript': 'Javascript',  // Mintlify uses "Javascript" for TS/JS
    'Python': 'Python',
    'Java': 'Java',
    'Go': 'Go',
    'Ruby': 'Ruby'
  };
  
  // Code block supported languages (what Mintlify shows in code blocks)
  const CODE_BLOCK_LANGUAGES = ['Javascript', 'Python', 'Go', 'Java', 'Ruby', 'cURL', 'PHP'];
  
  let currentSelectedLanguage = 'TypeScript';
  let isSelecting = false;
  
  // ============================================
  // CSS INJECTION
  // ============================================
  
  // Map dropdown language names to SDK path suffixes
  const SDK_PATH_MAP = {
    'Python': 'python',
    'Java': 'java',
    'Go': 'go',
    'Ruby': 'ruby'
  };

  // Map dropdown languages to their landing pages
  const LANGUAGE_LANDING_PAGES = {
    'TypeScript': '/v3/first-steps/introduction',
    'Python': '/v3/sdk/python',
    'Java': '/v3/sdk/java',
    'Go': '/v3/sdk/go',
    'Ruby': '/v3/sdk/ruby'
  };

  // Generic code icon SVG used for all languages in the dropdown button
  const GENERIC_CODE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stagehand-code-icon"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';

  const dropdownStyle = document.createElement('style');
  dropdownStyle.id = 'stagehand-language-style';
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
  
  // ============================================
  // SDK REFERENCE FILTERING
  // ============================================
  
  function updateSDKReferenceVisibility() {
    // Get the SDK path for the current language
    const currentSDKPath = SDK_PATH_MAP[currentSelectedLanguage];
    
    // Find all SDK reference items in the sidebar
    const sdkItems = document.querySelectorAll('li[id^="/v3/sdk/"]');
    
    sdkItems.forEach(item => {
      const itemId = item.getAttribute('id') || '';
      // Extract the language from the id (e.g., "/v3/sdk/python" -> "python")
      const itemLang = itemId.split('/').pop();
      
      if (currentSelectedLanguage === 'TypeScript') {
        // For TypeScript, hide all SDK references (they don't apply)
        item.classList.add('stagehand-sdk-hidden');
      } else if (currentSDKPath && itemLang === currentSDKPath) {
        // Show the SDK that matches the current language
        item.classList.remove('stagehand-sdk-hidden');
      } else {
        // Hide SDKs that don't match
        item.classList.add('stagehand-sdk-hidden');
      }
    });
  }

  // ============================================
  // VERSION SWITCHER VISIBILITY
  // ============================================
  
  function getVersionSwitcher() {
    // Find the version switcher button (contains "v3" or "v2" and has chevron-down)
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      // Check if it's a version button (v2, v3, etc.) with chevron icon
      if (/^v\d+$/.test(text) && btn.querySelector('.lucide-chevron-down')) {
        return btn;
      }
    }
    return null;
  }
  
  function updateVersionSwitcherVisibility() {
    const versionSwitcher = getVersionSwitcher();
    
    if (versionSwitcher) {
      // Mark the version switcher so we can target it with CSS
      versionSwitcher.classList.add('stagehand-version-switcher');
      
      // Show version switcher only for TypeScript
      if (currentSelectedLanguage === 'TypeScript') {
        document.body.classList.remove('stagehand-hide-version-switcher');
      } else {
        document.body.classList.add('stagehand-hide-version-switcher');
      }
    }
  }
  
  // ============================================
  // SIDEBAR DROPDOWN FUNCTIONS
  // ============================================
  
  function getDropdownButton() {
    // Look for the language dropdown button in the sidebar
    // It's a button containing a language name OR has the dropdown chevron structure
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
      // Match by language name
      if (DROPDOWN_LANGUAGES.includes(text)) {
        return btn;
      }
      // Also check if it has the dropdown structure (icon + text + chevron)
      const hasChevron = btn.querySelector('.lucide-chevron-down');
      const hasParagraph = btn.querySelector('p');
      if (hasChevron && hasParagraph) {
        // Check if it's in the sidebar navigation area (not version switcher)
        const parent = btn.closest('nav, aside, [class*="sidebar"]');
        if (parent && !btn.classList.contains('stagehand-version-switcher')) {
          const pText = (hasParagraph.textContent || '').trim();
          // Verify it's a language dropdown (text should be a language name)
          if (DROPDOWN_LANGUAGES.some(lang => pText === lang || pText.includes(lang))) {
            return btn;
          }
        }
      }
    }
    return null;
  }
  
  function getDropdownMenu() {
    return document.querySelector('menu[role="menu"], [role="menu"]');
  }
  
  function updateButtonText(newText) {
    const button = getDropdownButton();
    if (!button) return false;

    let updated = false;
    const paragraph = button.querySelector('p');
    if (paragraph && paragraph.textContent !== newText) {
      paragraph.textContent = newText;
      updated = true;
    }

    // Always use generic code icon - hide any existing icons and inject ours
    const existingImg = button.querySelector('img');
    const existingSvg = button.querySelector('svg:not(.lucide-chevron-down):not(.stagehand-code-icon)');
    const codeIcon = button.querySelector('.stagehand-code-icon');

    // Hide any existing icons
    if (existingImg) {
      existingImg.style.display = 'none';
    }
    if (existingSvg) {
      existingSvg.style.display = 'none';
    }

    // Inject generic code icon if not already present
    if (!codeIcon) {
      const template = document.createElement('template');
      template.innerHTML = GENERIC_CODE_ICON.trim();
      const newIcon = template.content.firstChild;
      const firstChild = button.firstElementChild;
      if (firstChild) {
        button.insertBefore(newIcon, firstChild);
      } else {
        button.appendChild(newIcon);
      }
      updated = true;
    }

    return updated;
  }
  
  function updateDropdownCheckIndicator() {
    const menu = getDropdownMenu();
    if (!menu) return;
    
    const menuItems = menu.querySelectorAll('a, [role="menuitem"]');
    const checkIconsMap = new Map();
    let anyCheckIcon = null;
    
    for (const item of menuItems) {
      const text = (item.textContent || '').trim();
      const checkIcon = item.querySelector('.lucide-check, [class*="lucide-check"], svg[class*="check"]');
      
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
        checkIcon.style.opacity = shouldBeSelected ? '1' : '0';
        checkIcon.style.visibility = shouldBeSelected ? 'visible' : 'hidden';
      } else if (shouldBeSelected && anyCheckIcon) {
        const clonedCheck = anyCheckIcon.cloneNode(true);
        clonedCheck.style.opacity = '1';
        clonedCheck.style.visibility = 'visible';
        
        const targetSpan = item.querySelector('span:last-child') || item;
        if (targetSpan.querySelector('.lucide-check, [class*="lucide-check"]') === null) {
          targetSpan.appendChild(clonedCheck);
        }
      }
    }
  }
  
  // ============================================
  // CODE BLOCK LANGUAGE SELECTOR FUNCTIONS
  // ============================================
  
  function simulateClick(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
      const EventClass = eventType.startsWith('pointer') ? PointerEvent : MouseEvent;
      element.dispatchEvent(new EventClass(eventType, {
        view: window, bubbles: true, cancelable: true,
        clientX: x, clientY: y, button: 0, buttons: 1,
        isPrimary: true, pointerType: 'mouse'
      }));
    });
  }
  
  function getCodeBlockLanguageDropdown() {
    const paragraphs = document.querySelectorAll('p');
    
    for (const p of paragraphs) {
      const text = (p.textContent || '').trim();
      if (CODE_BLOCK_LANGUAGES.includes(text)) {
        const parentDiv = p.closest('div');
        if (parentDiv && parentDiv.querySelector('.lucide-chevrons-up-down')) {
          return { element: parentDiv, language: text };
        }
      }
    }
    return null;
  }
  
  function waitForCodeBlockMenuAndSelect(targetLanguage, attempts = 0) {
    if (attempts > 30) {
      document.body.classList.remove('stagehand-selecting');
      document.body.click();
      isSelecting = false;
      return;
    }

    const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');
    
    if (menuItems.length === 0) {
      setTimeout(() => waitForCodeBlockMenuAndSelect(targetLanguage, attempts + 1), 50);
      return;
    }

    for (const item of menuItems) {
      const text = (item.textContent || '').trim();
      if (text === targetLanguage) {
        simulateClick(item);
        setTimeout(() => {
          document.body.classList.remove('stagehand-selecting');
          isSelecting = false;
        }, 50);
        return;
      }
    }
    
    setTimeout(() => waitForCodeBlockMenuAndSelect(targetLanguage, attempts + 1), 50);
  }

  function selectCodeBlockLanguage(targetLanguage) {
    if (isSelecting) return;
    
    const current = getCodeBlockLanguageDropdown();
    if (!current) return;
    if (current.language === targetLanguage) return;
    
    isSelecting = true;
    document.body.classList.add('stagehand-selecting');
    simulateClick(current.element);
    setTimeout(() => waitForCodeBlockMenuAndSelect(targetLanguage), 10);
  }
  
  function syncCodeBlockLanguage() {
    const codeBlockLang = LANGUAGE_MAP[currentSelectedLanguage];
    if (codeBlockLang) {
      // Try to find and update all code block language dropdowns
      setTimeout(() => selectCodeBlockLanguage(codeBlockLang), 100);
    }
  }
  
  // ============================================
  // EVENT HANDLERS & OBSERVERS
  // ============================================
  
  function setupDropdownMenuObserver() {
    const menuObserver = new MutationObserver(() => {
      const menu = getDropdownMenu();
      
      if (menu) {
        updateDropdownCheckIndicator();
        setTimeout(updateDropdownCheckIndicator, 10);
        setTimeout(updateDropdownCheckIndicator, 50);
        setTimeout(updateDropdownCheckIndicator, 100);
      }
    });
    
    menuObserver.observe(document.body, {
      subtree: true,
      childList: true
    });
  }
  
  function setupMenuClickHandler() {
    document.addEventListener('click', (e) => {
      const target = e.target;

      // Check if we clicked on a sidebar dropdown menu item
      const menuItem = target.closest('[role="menu"] a, menu a');
      if (!menuItem) return;

      const text = (menuItem.textContent || '').trim();

      // Check if it's one of our language options
      for (const lang of DROPDOWN_LANGUAGES) {
        if (text.includes(lang)) {
          // Prevent default navigation - we'll handle it explicitly
          e.preventDefault();
          e.stopPropagation();

          currentSelectedLanguage = lang;

          // Update the check indicator immediately
          updateDropdownCheckIndicator();

          // Update version switcher visibility
          updateVersionSwitcherVisibility();

          // Update SDK reference visibility
          updateSDKReferenceVisibility();

          // Store in sessionStorage
          try {
            sessionStorage.setItem('stagehand-selected-language', lang);
          } catch (err) {
            // Ignore storage errors
          }

          // Navigate to the language's landing page
          // sessionStorage is already saved, so restoreLanguageSelection() on the new page will apply the state
          const landingPage = LANGUAGE_LANDING_PAGES[lang];
          if (landingPage) {
            window.location.href = landingPage;
          }

          break;
        }
      }
    }, true);
  }
  
  function restoreLanguageSelection(attempt = 0) {
    const maxAttempts = 5;

    try {
      const stored = sessionStorage.getItem('stagehand-selected-language');
      if (stored && DROPDOWN_LANGUAGES.includes(stored)) {
        currentSelectedLanguage = stored;

        const updated = updateButtonText(stored);

        // If button not found or not updated, retry
        if (!updated && attempt < maxAttempts) {
          setTimeout(() => restoreLanguageSelection(attempt + 1), 50);
        }

        // Update version switcher visibility
        updateVersionSwitcherVisibility();

        // Update SDK reference visibility
        updateSDKReferenceVisibility();

        // Also sync code block language on restore
        if (attempt === 0) {
          syncCodeBlockLanguage();
        }
      }
    } catch (err) {
      // Ignore storage errors
    }
  }
  
  function setupPageChangeObserver() {
    let sdkUpdatePending = false;
    let buttonUpdatePending = false;

    const observer = new MutationObserver(() => {
      // Check if button needs updating (debounced to avoid excessive updates)
      if (!buttonUpdatePending) {
        buttonUpdatePending = true;
        setTimeout(() => {
          const button = getDropdownButton();
          if (button) {
            const paragraph = button.querySelector('p');
            const currentText = paragraph ? (paragraph.textContent || '').trim() : '';
            if (currentText !== currentSelectedLanguage && DROPDOWN_LANGUAGES.includes(currentSelectedLanguage)) {
              updateButtonText(currentSelectedLanguage);
            }
          }
          buttonUpdatePending = false;
        }, 10);
      }

      // Re-check version switcher visibility (DOM might have re-rendered)
      const versionSwitcher = getVersionSwitcher();
      if (versionSwitcher && !versionSwitcher.classList.contains('stagehand-version-switcher')) {
        updateVersionSwitcherVisibility();
      }

      // Check for SDK reference items that need to be hidden (debounced)
      const sdkItems = document.querySelectorAll('li[id^="/v3/sdk/"]:not(.stagehand-sdk-processed)');
      if (sdkItems.length > 0 && !sdkUpdatePending) {
        sdkUpdatePending = true;
        setTimeout(() => {
          updateSDKReferenceVisibility();
          // Mark items as processed to avoid repeated updates
          document.querySelectorAll('li[id^="/v3/sdk/"]').forEach(item => {
            item.classList.add('stagehand-sdk-processed');
          });
          sdkUpdatePending = false;
        }, 50);
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true
    });
  }
  
  // Watch for code block dropdowns appearing and sync them
  function setupCodeBlockObserver() {
    let lastCodeBlockDropdown = null;

    const observer = new MutationObserver(() => {
      const dropdown = getCodeBlockLanguageDropdown();
      if (dropdown && dropdown.element !== lastCodeBlockDropdown) {
        lastCodeBlockDropdown = dropdown.element;

        // New code block dropdown appeared, sync it
        const targetLang = LANGUAGE_MAP[currentSelectedLanguage];
        if (targetLang && dropdown.language !== targetLang) {
          setTimeout(() => selectCodeBlockLanguage(targetLang), 50);
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true
    });
  }
  
  // ============================================
  // INITIALIZATION
  // ============================================
  
  function init() {
    setupMenuClickHandler();
    setupDropdownMenuObserver();
    setupPageChangeObserver();
    setupCodeBlockObserver();

    // Restore language selection immediately and retry quickly
    restoreLanguageSelection();
    setTimeout(restoreLanguageSelection, 50);
    setTimeout(restoreLanguageSelection, 150);

    // Update version switcher and SDK visibility
    updateVersionSwitcherVisibility();
    updateSDKReferenceVisibility();
    setTimeout(updateVersionSwitcherVisibility, 200);
    setTimeout(updateSDKReferenceVisibility, 200);
  }

  // Initialize on page load - start immediately, no artificial delay
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-run when URL changes (SPA navigation)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Remove processed class so SDK items get re-evaluated
      document.querySelectorAll('li[id^="/v3/sdk/"].stagehand-sdk-processed').forEach(item => {
        item.classList.remove('stagehand-sdk-processed');
      });
      // Restore immediately and retry once
      restoreLanguageSelection();
      setTimeout(restoreLanguageSelection, 100);
      syncCodeBlockLanguage();
      updateVersionSwitcherVisibility();
      updateSDKReferenceVisibility();
    }
  });
  urlObserver.observe(document.body, { subtree: true, childList: true });
})();
