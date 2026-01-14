// Language switcher for Stagehand docs
// Handles: 1) Sidebar language dropdown selection 2) Code block language syncing

(function() {
  // ============================================
  // CONFIGURATION
  // ============================================

  const DROPDOWN_LANGUAGES = ['TypeScript', 'Python', 'Java', 'Go', 'Ruby'];

  const LANGUAGE_MAP = {
    'TypeScript': 'Javascript',
    'Python': 'Python',
    'Java': 'Java',
    'Go': 'Go',
    'Ruby': 'Ruby'
  };

  const CODE_BLOCK_LANGUAGES = ['Javascript', 'Python', 'Go', 'Java', 'Ruby', 'cURL', 'PHP'];

  const SDK_PATH_MAP = {
    'Python': 'python',
    'Java': 'java',
    'Go': 'go',
    'Ruby': 'ruby'
  };

  const NAVIGATION_MAP = {
    'TypeScript': '/v3/first-steps/introduction',
    'Python': '/v3/sdk/python',
    'Java': '/v3/sdk/java',
    'Go': '/v3/sdk/go',
    'Ruby': '/v3/sdk/ruby'
  };

  let currentSelectedLanguage = 'TypeScript';
  let isSelecting = false;

  // ============================================
  // UTILITIES
  // ============================================

  // Run callback on next frame (immediate visual update)
  const onNextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  // Wait for an element matching selector to appear
  function waitForElement(selector, callback, maxAttempts = 20) {
    let attempts = 0;
    const check = () => {
      const el = document.querySelector(selector);
      if (el) {
        callback(el);
      } else if (++attempts < maxAttempts) {
        requestAnimationFrame(check);
      }
    };
    check();
  }

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
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
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
    
    const paragraph = button.querySelector('p');
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
      requestAnimationFrame(() => waitForCodeBlockMenuAndSelect(targetLanguage, attempts + 1));
      return;
    }

    for (const item of menuItems) {
      const text = (item.textContent || '').trim();
      if (text === targetLanguage) {
        simulateClick(item);
        onNextFrame(() => {
          document.body.classList.remove('stagehand-selecting');
          isSelecting = false;
        });
        return;
      }
    }

    requestAnimationFrame(() => waitForCodeBlockMenuAndSelect(targetLanguage, attempts + 1));
  }

  function selectCodeBlockLanguage(targetLanguage) {
    if (isSelecting) return;

    const current = getCodeBlockLanguageDropdown();
    if (!current) return;
    if (current.language === targetLanguage) return;

    isSelecting = true;
    document.body.classList.add('stagehand-selecting');
    simulateClick(current.element);
    requestAnimationFrame(() => waitForCodeBlockMenuAndSelect(targetLanguage));
  }

  function syncCodeBlockLanguage() {
    const codeBlockLang = LANGUAGE_MAP[currentSelectedLanguage];
    if (codeBlockLang) {
      selectCodeBlockLanguage(codeBlockLang);
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
        onNextFrame(updateDropdownCheckIndicator);
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

          // Navigate to the corresponding SDK page
          const targetPath = NAVIGATION_MAP[lang];
          if (targetPath && !window.location.pathname.endsWith(targetPath)) {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = targetPath;
            return;
          }

          // Update button text after menu closes
          onNextFrame(() => updateButtonText(lang));

          // Sync the code block language selector
          onNextFrame(syncCodeBlockLanguage);

          break;
        }
      }
    }, true);
  }
  
  function restoreLanguageSelection() {
    try {
      const stored = sessionStorage.getItem('stagehand-selected-language');
      if (stored && DROPDOWN_LANGUAGES.includes(stored)) {
        currentSelectedLanguage = stored;
        updateButtonText(stored);
        updateVersionSwitcherVisibility();
        updateSDKReferenceVisibility();
        onNextFrame(syncCodeBlockLanguage);
      }
    } catch (err) {
      // Ignore storage errors
    }

    // Always update visibility on restore
    onNextFrame(() => {
      updateVersionSwitcherVisibility();
      updateSDKReferenceVisibility();
    });
  }
  
  function setupPageChangeObserver() {
    let sdkUpdatePending = false;

    const observer = new MutationObserver(() => {
      // Check if button needs updating
      const button = getDropdownButton();
      if (button) {
        const currentText = (button.textContent || '').trim();
        if (currentText !== currentSelectedLanguage && DROPDOWN_LANGUAGES.includes(currentSelectedLanguage)) {
          updateButtonText(currentSelectedLanguage);
        }
      }

      // Re-check version switcher visibility (DOM might have re-rendered)
      const versionSwitcher = getVersionSwitcher();
      if (versionSwitcher && !versionSwitcher.classList.contains('stagehand-version-switcher')) {
        updateVersionSwitcherVisibility();
      }

      // Check for SDK reference items that need to be hidden (debounced via rAF)
      const sdkItems = document.querySelectorAll('li[id^="/v3/sdk/"]:not(.stagehand-sdk-processed)');
      if (sdkItems.length > 0 && !sdkUpdatePending) {
        sdkUpdatePending = true;
        onNextFrame(() => {
          updateSDKReferenceVisibility();
          document.querySelectorAll('li[id^="/v3/sdk/"]').forEach(item => {
            item.classList.add('stagehand-sdk-processed');
          });
          sdkUpdatePending = false;
        });
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
          onNextFrame(() => selectCodeBlockLanguage(targetLang));
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

    restoreLanguageSelection();
    updateVersionSwitcherVisibility();
    updateSDKReferenceVisibility();
  }

  // Initialize on page load
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
      onNextFrame(() => {
        restoreLanguageSelection();
        syncCodeBlockLanguage();
        updateVersionSwitcherVisibility();
        updateSDKReferenceVisibility();
      });
    }
  });
  urlObserver.observe(document.body, { subtree: true, childList: true });
})();
