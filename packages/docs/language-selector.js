// Auto-select code sample language based on the current version
// This script makes the selection instant and invisible to users

(function() {
  // Map version names to their corresponding SDK language labels
  const versionToLanguage = {
    'python': 'Python',
    'go': 'Go',
    'java': 'Java',
    'ruby': 'Ruby',
    'v3': 'Javascript',
    'v2': 'Javascript'
  };

  let lastVersion = null;
  let isSelecting = false;

  // Inject CSS to hide dropdown during programmatic selection
  const style = document.createElement('style');
  style.id = 'stagehand-lang-selector-style';
  style.textContent = `
    .stagehand-selecting [role="menu"],
    .stagehand-selecting [role="listbox"] {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: none !important;
    }
  `;
  document.head.appendChild(style);

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

  function getSelectedVersion() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (Object.keys(versionToLanguage).some(v => text === v)) {
        return text;
      }
    }
    return null;
  }

  function getCurrentLanguageDropdown() {
    const paragraphs = document.querySelectorAll('p');
    const languages = ['Javascript', 'Python', 'Go', 'Java', 'Ruby', 'cURL', 'PHP'];
    
    for (const p of paragraphs) {
      const text = (p.textContent || '').trim();
      if (languages.includes(text)) {
        const parentDiv = p.closest('div');
        if (parentDiv && parentDiv.querySelector('.lucide-chevrons-up-down')) {
          return { element: parentDiv, language: text };
        }
      }
    }
    return null;
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
      // Use exact match to avoid "Java" matching "Javascript"
      if (text === targetLanguage) {
        simulateClick(item);
        // Clean up after a short delay
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
    
    // Hide dropdown animation by adding class to body
    document.body.classList.add('stagehand-selecting');
    
    // Click to open dropdown
    simulateClick(current.element);
    
    // Immediately look for menu items
    setTimeout(() => waitForMenuAndSelect(targetLanguage), 10);
  }

  function autoSelectLanguage() {
    if (!window.location.pathname.includes('/api-reference')) return;
    
    const version = getSelectedVersion();
    if (!version) return;
    
    const targetLanguage = versionToLanguage[version];
    if (!targetLanguage) return;
    
    selectLanguage(targetLanguage);
  }

  function checkAndUpdate() {
    if (!window.location.pathname.includes('/api-reference')) {
      lastVersion = null;
      return;
    }
    
    const currentVersion = getSelectedVersion();
    if (currentVersion && currentVersion !== lastVersion) {
      lastVersion = currentVersion;
      setTimeout(autoSelectLanguage, 300);
    }
  }

  function init() {
    setTimeout(() => {
      lastVersion = getSelectedVersion();
      autoSelectLanguage();
    }, 1000);
    
    setInterval(checkAndUpdate, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-run when URL changes (SPA navigation)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastVersion = null;
      setTimeout(autoSelectLanguage, 1000);
    }
  }).observe(document.body, { subtree: true, childList: true });
})();