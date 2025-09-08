/**
 * Script to convert OS-level select dropdowns to custom dropdowns
 * This script is injected into the page before agent actions
 */

export const dropdownConverterScript = `
(function() {
  // Track converted selects to avoid duplicate conversions
  const convertedSelects = new WeakSet();
  
  function createCustomDropdown(selectElement) {
    // Skip if already converted
    if (convertedSelects.has(selectElement)) return;
    
    // Skip if select is hidden or disabled
    if (selectElement.style.display === 'none' || 
        selectElement.style.visibility === 'hidden' ||
        selectElement.disabled) {
      return;
    }
    
    // Mark as converted
    convertedSelects.add(selectElement);
    
    // Create wrapper container
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-dropdown-wrapper';
    wrapper.style.cssText = \`
      position: relative;
      display: inline-block;
      width: \${selectElement.offsetWidth}px;
    \`;
    
    // Create display element
    const display = document.createElement('div');
    display.className = 'custom-dropdown-display';
    display.style.cssText = \`
      padding: 12px 40px 12px 16px;
      border: 2px solid #2563eb;
      border-radius: 8px;
      background: #f0f9ff;
      cursor: pointer;
      user-select: none;
      position: relative;
      min-height: 24px;
      font-size: 16px;
      font-weight: 500;
      color: #1e293b;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      transition: all 0.2s ease;
    \`;
    
    // Create text span for selected value
    const selectedText = document.createElement('span');
    selectedText.style.cssText = \`
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    \`;
    display.appendChild(selectedText);
    
    // Create dropdown arrow
    const arrow = document.createElement('div');
    arrow.style.cssText = \`
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid #2563eb;
      transition: transform 0.2s ease;
    \`;
    display.appendChild(arrow);
    
    // Create options container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-dropdown-options';
    optionsContainer.style.cssText = \`
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      max-height: 240px;
      overflow-y: auto;
      background: white;
      border: 2px solid #2563eb;
      border-radius: 8px;
      display: none;
      z-index: 9999;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
    \`;
    
    // Create option elements
    const options = selectElement.options;
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      const optionDiv = document.createElement('div');
      optionDiv.className = 'custom-dropdown-option';
      optionDiv.textContent = option.textContent;
      optionDiv.dataset.value = option.value;
      optionDiv.dataset.index = i;
      
      optionDiv.style.cssText = \`
        padding: 12px 16px;
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 15px;
        color: #1e293b;
        border-bottom: 1px solid #e5e7eb;
      \`;
      
      // Remove border from last option
      if (i === options.length - 1) {
        optionDiv.style.borderBottom = 'none';
      }
      
      // Hover effect
      optionDiv.addEventListener('mouseenter', () => {
        optionDiv.style.backgroundColor = '#eff6ff';
        optionDiv.style.paddingLeft = '20px';
      });
      
      optionDiv.addEventListener('mouseleave', () => {
        optionDiv.style.backgroundColor = option.selected ? '#dbeafe' : '';
        optionDiv.style.paddingLeft = '16px';
      });
      
      // Click handler
      optionDiv.addEventListener('click', () => {
        selectElement.selectedIndex = i;
        selectElement.dispatchEvent(new Event('change', { bubbles: true }));
        updateDisplay();
        closeDropdown();
      });
      
      if (option.selected) {
        optionDiv.style.backgroundColor = '#dbeafe';
        optionDiv.style.fontWeight = '600';
      }
      
      optionsContainer.appendChild(optionDiv);
    }
    
    // Update display text
    function updateDisplay() {
      const selectedOption = selectElement.options[selectElement.selectedIndex];
      selectedText.textContent = selectedOption ? selectedOption.textContent : '';
    }
    
    // Open/close dropdown
    function openDropdown() {
      optionsContainer.style.display = 'block';
      arrow.style.transform = 'translateY(-50%) rotate(180deg)';
      display.style.borderColor = '#1d4ed8';
      display.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)';
    }
    
    function closeDropdown() {
      optionsContainer.style.display = 'none';
      arrow.style.transform = 'translateY(-50%) rotate(0deg)';
      display.style.borderColor = '#2563eb';
      display.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
    }
    
    // Click handler for display
    display.addEventListener('click', (e) => {
      e.stopPropagation();
      if (optionsContainer.style.display === 'none') {
        openDropdown();
      } else {
        closeDropdown();
      }
    });
    
    // Close on outside click
    document.addEventListener('click', () => {
      closeDropdown();
    });
    
    // Insert wrapper before select
    selectElement.parentNode.insertBefore(wrapper, selectElement);
    wrapper.appendChild(display);
    wrapper.appendChild(optionsContainer);
    wrapper.appendChild(selectElement);
    
    // Hide original select
    selectElement.style.position = 'absolute';
    selectElement.style.opacity = '0';
    selectElement.style.pointerEvents = 'none';
    selectElement.style.width = '100%';
    selectElement.style.height = '100%';
    selectElement.style.top = '0';
    selectElement.style.left = '0';
    
    // Initial display update
    updateDisplay();
    
    // Update custom dropdown when select changes
    selectElement.addEventListener('change', updateDisplay);
  }
  
  // Convert all existing selects
  function convertAllSelects() {
    const selects = document.querySelectorAll('select');
    selects.forEach(select => createCustomDropdown(select));
  }
  
  // Initial conversion
  convertAllSelects();
  
  // Set up MutationObserver to handle dynamically added elements
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      // Check added nodes
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if the node itself is a select
          if (node.tagName === 'SELECT') {
            createCustomDropdown(node);
          }
          // Check for selects within the added node
          if (node.querySelectorAll) {
            const selects = node.querySelectorAll('select');
            selects.forEach(select => createCustomDropdown(select));
          }
        }
      });
      
      // Handle attribute changes (e.g., display/visibility changes)
      if (mutation.type === 'attributes' && 
          mutation.target.tagName === 'SELECT' &&
          (mutation.attributeName === 'style' || 
           mutation.attributeName === 'disabled')) {
        createCustomDropdown(mutation.target);
      }
    });
  });
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'disabled']
  });
  
  // Store observer reference for cleanup if needed
  window.__dropdownConverterObserver = observer;
})();
`;

/**
 * Injects the dropdown converter script into a Playwright page
 * @param page - The Playwright page instance
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function injectDropdownConverter(page: any) {
  await page.addScriptTag({ content: dropdownConverterScript });
}
