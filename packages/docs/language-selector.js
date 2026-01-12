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
  `;
  document.head.appendChild(dropdownStyle);
  
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
          currentSelectedLanguage = lang;
          
          // Update the check indicator immediately
          updateDropdownCheckIndicator();
          
          // Update version switcher visibility
          updateVersionSwitcherVisibility();
          
          // Store in sessionStorage
          try {
            sessionStorage.setItem('stagehand-selected-language', lang);
          } catch (err) {
            // Ignore storage errors
          }
          
          // Update button text after a short delay (after menu closes)
          setTimeout(() => {
            updateButtonText(lang);
          }, 50);
          
          // Sync the code block language selector
          setTimeout(() => {
            syncCodeBlockLanguage();
          }, 200);
          
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
        
        // Update version switcher visibility
        updateVersionSwitcherVisibility();
        
        // Also sync code block language on restore
        setTimeout(syncCodeBlockLanguage, 1000);
      }
    } catch (err) {
      // Ignore storage errors
    }
    
    // Always update version switcher visibility on restore
    setTimeout(updateVersionSwitcherVisibility, 100);
  }
  
  function setupPageChangeObserver() {
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
          setTimeout(() => selectCodeBlockLanguage(targetLang), 500);
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
    
    setTimeout(restoreLanguageSelection, 500);
    
    // Update version switcher visibility on init and periodically check
    setTimeout(updateVersionSwitcherVisibility, 600);
    setTimeout(updateVersionSwitcherVisibility, 1000);
  }

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(init, 500);
    });
  } else {
    setTimeout(init, 500);
  }

  // Re-run when URL changes (SPA navigation)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        restoreLanguageSelection();
        // Sync code block language on page change
        setTimeout(syncCodeBlockLanguage, 500);
        // Update version switcher visibility on page change
        setTimeout(updateVersionSwitcherVisibility, 100);
        setTimeout(updateVersionSwitcherVisibility, 500);
      }, 500);
    }
  });
  urlObserver.observe(document.body, { subtree: true, childList: true });
})();
