// Language switcher for Stagehand docs
// Handles: 1) Code block language syncing 2) Version switcher visibility

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
  // DETECT CURRENT LANGUAGE FROM URL/DROPDOWN
  // ============================================
  
  function getCurrentLanguage() {
    // First try to detect from URL path
    const path = window.location.pathname;
    
    if (path.includes('/sdk/python') || path.includes('/api-reference/python')) {
      return 'Python';
    }
    if (path.includes('/sdk/java') || path.includes('/api-reference/java')) {
      return 'Java';
    }
    if (path.includes('/sdk/go') || path.includes('/api-reference/go')) {
      return 'Go';
    }
    if (path.includes('/sdk/ruby') || path.includes('/api-reference/ruby')) {
      return 'Ruby';
    }
    
    // Fall back to detecting from dropdown button text
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
      if (DROPDOWN_LANGUAGES.includes(text)) {
        return text;
      }
    }
    
    return 'TypeScript';
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
    const currentLanguage = getCurrentLanguage();
    const versionSwitcher = getVersionSwitcher();
    
    if (versionSwitcher) {
      // Mark the version switcher so we can target it with CSS
      versionSwitcher.classList.add('stagehand-version-switcher');
      
      // Show version switcher only for TypeScript
      if (currentLanguage === 'TypeScript') {
        document.body.classList.remove('stagehand-hide-version-switcher');
      } else {
        document.body.classList.add('stagehand-hide-version-switcher');
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
    const currentLanguage = getCurrentLanguage();
    const codeBlockLang = LANGUAGE_MAP[currentLanguage];
    if (codeBlockLang) {
      setTimeout(() => selectCodeBlockLanguage(codeBlockLang), 100);
    }
  }
  
  // ============================================
  // OBSERVERS
  // ============================================
  
  // Watch for code block dropdowns appearing and sync them
  function setupCodeBlockObserver() {
    let lastCodeBlockDropdown = null;
    
    const observer = new MutationObserver(() => {
      const dropdown = getCodeBlockLanguageDropdown();
      if (dropdown && dropdown.element !== lastCodeBlockDropdown) {
        lastCodeBlockDropdown = dropdown.element;
        
        // New code block dropdown appeared, sync it
        const currentLanguage = getCurrentLanguage();
        const targetLang = LANGUAGE_MAP[currentLanguage];
        if (targetLang && dropdown.language !== targetLang) {
          setTimeout(() => selectCodeBlockLanguage(targetLang), 500);
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
  
  // ============================================
  // INITIALIZATION
  // ============================================
  
  function init() {
    setupCodeBlockObserver();
    
    // Update version switcher visibility on init
    setTimeout(updateVersionSwitcherVisibility, 100);
    setTimeout(updateVersionSwitcherVisibility, 500);
    setTimeout(updateVersionSwitcherVisibility, 1000);
    
    // Sync code block language on init
    setTimeout(syncCodeBlockLanguage, 1000);
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
        // Update version switcher visibility on page change
        updateVersionSwitcherVisibility();
        // Sync code block language on page change
        setTimeout(syncCodeBlockLanguage, 500);
      }, 500);
    }
  });
  urlObserver.observe(document.body, { subtree: true, childList: true });
})();
