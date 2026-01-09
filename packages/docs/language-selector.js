// Dropdown selection manager and language selector for Stagehand docs
// Handles: 1) Sidebar dropdown selection state 2) API Reference language selection

(function() {
  // ============================================
  // PART 1: Sidebar Dropdown Selection Manager
  // ============================================
  
  const DROPDOWN_OPTIONS = ['Documentation', 'API Reference'];
  let currentSelectedDropdown = 'Documentation';
  
  // Inject CSS for styling
  const dropdownStyle = document.createElement('style');
  dropdownStyle.id = 'stagehand-dropdown-style';
  dropdownStyle.textContent = `
    /* Hide dropdown during programmatic selection */
    .stagehand-selecting [role="menu"],
    .stagehand-selecting [role="listbox"] {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: none !important;
    }
  `;
  document.head.appendChild(dropdownStyle);
  
  function getDropdownButton() {
    // Find the dropdown button in the sidebar
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
      if (DROPDOWN_OPTIONS.includes(text)) {
        return btn;
      }
    }
    return null;
  }
  
  function getDropdownMenu() {
    // Find the open dropdown menu
    return document.querySelector('menu[role="menu"], [role="menu"]');
  }
  
  function updateButtonText(newText) {
    const button = getDropdownButton();
    if (!button) return;
    
    // Find the paragraph or text element inside the button
    const paragraph = button.querySelector('p');
    if (paragraph) {
      paragraph.textContent = newText;
    }
  }
  
  function setupMenuClickHandler() {
    // Use event delegation on document to catch menu item clicks
    document.addEventListener('click', (e) => {
      const target = e.target;
      
      // Check if we clicked on a dropdown menu item
      const menuItem = target.closest('[role="menu"] a, menu a');
      if (!menuItem) return;
      
      const text = (menuItem.textContent || '').trim();
      
      // Check if it's one of our dropdown options
      for (const option of DROPDOWN_OPTIONS) {
        if (text.includes(option)) {
          currentSelectedDropdown = option;
          
          // Store in sessionStorage
          try {
            sessionStorage.setItem('stagehand-selected-dropdown', option);
          } catch (err) {
            // Ignore storage errors
          }
          
          // Update button text after a short delay (after menu closes)
          setTimeout(() => {
            updateButtonText(option);
          }, 50);
          
          break;
        }
      }
    }, true); // Use capture phase
  }
  
  function restoreDropdownSelection() {
    // Restore from sessionStorage if available
    try {
      const stored = sessionStorage.getItem('stagehand-selected-dropdown');
      if (stored && DROPDOWN_OPTIONS.includes(stored)) {
        currentSelectedDropdown = stored;
        updateButtonText(stored);
      }
    } catch (err) {
      // Ignore storage errors
    }
  }
  
  function initDropdownManager() {
    // Set up click handler
    setupMenuClickHandler();
    
    // Restore selection after page load
    setTimeout(restoreDropdownSelection, 500);
    
    // Also restore on navigation (Mintlify re-renders)
    const observer = new MutationObserver(() => {
      // Check if button needs updating
      const button = getDropdownButton();
      if (button) {
        const currentText = (button.textContent || '').trim();
        if (currentText !== currentSelectedDropdown && DROPDOWN_OPTIONS.includes(currentSelectedDropdown)) {
          updateButtonText(currentSelectedDropdown);
        }
      }
    });
    
    observer.observe(document.body, {
      subtree: true,
      childList: true
    });
  }
  
  // ============================================
  // PART 2: API Reference Language Selector
  // ============================================
  
  const supportedLanguages = ['Javascript', 'Python', 'Go', 'Java', 'Ruby', 'cURL', 'PHP'];
  let lastSelectedLanguage = null;
  let isSelecting = false;
  let languageChangeObserver = null;

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

  function isV3Selected() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text === 'v3') {
        return true;
      }
    }
    return false;
  }

  function isApiReferencePage() {
    return window.location.pathname.includes('/api-reference') || 
           window.location.pathname.includes('/v1/sessions');
  }

  function getCurrentLanguageDropdown() {
    const paragraphs = document.querySelectorAll('p');
    
    for (const p of paragraphs) {
      const text = (p.textContent || '').trim();
      if (supportedLanguages.includes(text)) {
        const parentDiv = p.closest('div');
        if (parentDiv && parentDiv.querySelector('.lucide-chevrons-up-down')) {
          return { element: parentDiv, language: text };
        }
      }
    }
    return null;
  }

  function getCurrentSelectedLanguage() {
    const dropdown = getCurrentLanguageDropdown();
    return dropdown ? dropdown.language : null;
  }

  function waitForMenuAndSelect(targetLanguage, attempts = 0) {
    if (attempts > 30) {
      document.body.classList.remove('stagehand-selecting');
      document.body.click();
      isSelecting = false;
      return;
    }

    const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');
    
    if (menuItems.length === 0) {
      setTimeout(() => waitForMenuAndSelect(targetLanguage, attempts + 1), 50);
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
    
    setTimeout(() => waitForMenuAndSelect(targetLanguage, attempts + 1), 50);
  }

  function selectLanguage(targetLanguage) {
    if (isSelecting) return;
    
    const current = getCurrentLanguageDropdown();
    if (!current) return;
    if (current.language === targetLanguage) return;
    
    isSelecting = true;
    document.body.classList.add('stagehand-selecting');
    simulateClick(current.element);
    setTimeout(() => waitForMenuAndSelect(targetLanguage), 10);
  }

  function handleLanguageChange() {
    if (!isV3Selected() || !isApiReferencePage()) {
      lastSelectedLanguage = null;
      return;
    }

    const currentLanguage = getCurrentSelectedLanguage();
    if (currentLanguage && currentLanguage !== lastSelectedLanguage) {
      lastSelectedLanguage = currentLanguage;
      document.dispatchEvent(new CustomEvent('stagehand-language-changed', {
        detail: { language: currentLanguage }
      }));
    }
  }

  function setupLanguageObserver() {
    if (languageChangeObserver) {
      languageChangeObserver.disconnect();
    }

    languageChangeObserver = new MutationObserver(() => {
      handleLanguageChange();
    });

    languageChangeObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-selected']
    });
  }

  function initLanguageSelector() {
    if (!isV3Selected() || !isApiReferencePage()) {
      return;
    }

    setTimeout(() => {
      lastSelectedLanguage = getCurrentSelectedLanguage();
      handleLanguageChange();
    }, 1000);

    setupLanguageObserver();

    setInterval(() => {
      if (isV3Selected() && isApiReferencePage()) {
        handleLanguageChange();
      }
    }, 500);
  }

  function checkAndReinit() {
    if (isV3Selected() && isApiReferencePage()) {
      initLanguageSelector();
    } else {
      if (languageChangeObserver) {
        languageChangeObserver.disconnect();
        languageChangeObserver = null;
      }
      lastSelectedLanguage = null;
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  
  function init() {
    // Initialize dropdown manager (always)
    initDropdownManager();
    
    // Initialize language selector (only on API reference pages)
    checkAndReinit();
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
        restoreDropdownSelection();
        checkAndReinit();
      }, 500);
    }
  });
  urlObserver.observe(document.body, { subtree: true, childList: true });
})();
