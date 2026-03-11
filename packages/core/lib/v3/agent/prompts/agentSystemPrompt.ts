import type { AgentToolMode, Variables } from "../../types/public/agent.js";

export interface AgentSystemPromptOptions {
  url: string;
  executionInstruction: string;
  mode: AgentToolMode;
  systemInstructions?: string;
  /** Whether running on Browserbase (enables captcha solver messaging) */
  isBrowserbase?: boolean;
  /** Tools to exclude from the system prompt */
  excludeTools?: string[];
  /** Variables available to the agent for use in act/type tools */
  variables?: Variables;
}

/**
 * Builds the system prompt for the agent based on the tool mode.
 *
 * @param options - The prompt configuration options
 * @returns The formatted system prompt string
 */
interface ToolDefinition {
  name: string;
  description: string;
}

function buildToolsSection(
  isHybridMode: boolean,
  hasSearch: boolean,
  excludeTools?: string[],
): string {
  const excludeSet = new Set(excludeTools ?? []);

  const hybridTools: ToolDefinition[] = [
    {
      name: "screenshot",
      description:
        "Take a screenshot for visual context. Also returns page metadata (viewport size, scroll height, element counts) to help decide if ariaTree is needed.",
    },
    {
      name: "ariaTree",
      description:
        "Get an accessibility (ARIA) hybrid tree with element IDs for full page context. Only use when screenshot metadata indicates the page is large or target element is not visible.",
    },
    {
      name: "actOnElement",
      description:
        "Act directly on an ariaTree element by its ID (e.g. '0-37'). PREFERRED over act when you already have ariaTree — faster because it skips redundant element inference.",
    },
    {
      name: "click",
      description:
        "Click on an element by coordinates (PREFERRED when element is visible in viewport)",
    },
    {
      name: "type",
      description:
        "Type text into an element by coordinates (PREFERRED when element is visible in viewport)",
    },
    {
      name: "act",
      description:
        "Perform an action by description — use only when you do NOT have ariaTree element IDs and the element is not visible in the screenshot.",
    },
    {
      name: "hover",
      description:
        "Hover over an element by coordinates to reveal tooltips, dropdown menus, sub-navigation, or other hover-triggered content. Returns a screenshot showing the result.",
    },
    { name: "dragAndDrop", description: "Drag and drop an element" },
    { name: "clickAndHold", description: "Click and hold on an element" },
    { name: "keys", description: "Press a keyboard key" },
    {
      name: "fillFormVision",
      description: "Fill out a form using coordinates",
    },
    { name: "think", description: "Think about the task" },
    { name: "extract", description: "Extract structured data" },
    { name: "goto", description: "Navigate to a URL" },
    { name: "wait", description: "Wait for a specified time" },
    { name: "navback", description: "Navigate back in browser history" },
    { name: "scroll", description: "Scroll the page x pixels up or down" },
  ];

  const domTools: ToolDefinition[] = [
    {
      name: "screenshot",
      description:
        "Take a screenshot for visual context. Also returns page metadata (viewport size, scroll height, element counts).",
    },
    {
      name: "ariaTree",
      description:
        "Get an accessibility (ARIA) hybrid tree with element IDs for full page context",
    },
    {
      name: "actOnElement",
      description:
        "Act directly on an ariaTree element by its ID (e.g. '0-37'). PREFERRED over act when you already have ariaTree — faster because it skips redundant element inference.",
    },
    {
      name: "act",
      description:
        "Perform an action by description — use when you do NOT have ariaTree element IDs",
    },
    { name: "keys", description: "Press a keyboard key" },
    { name: "fillForm", description: "Fill out a form" },
    { name: "think", description: "Think about the task" },
    { name: "extract", description: "Extract structured data" },
    { name: "goto", description: "Navigate to a URL" },
    { name: "wait", description: "Wait for a specified time" },
    { name: "navback", description: "Navigate back in browser history" },
    { name: "scroll", description: "Scroll the page x pixels up or down" },
  ];

  const baseTools = isHybridMode ? hybridTools : domTools;

  if (hasSearch) {
    baseTools.push({
      name: "search",
      description:
        "Perform a web search and return results. Prefer this over navigating to Google and searching within the page for reliability and efficiency.",
    });
  }

  const filteredTools = baseTools.filter((tool) => !excludeSet.has(tool.name));

  const toolLines = filteredTools
    .map((tool) => `    <tool name="${tool.name}">${tool.description}</tool>`)
    .join("\n");

  return `<tools>\n${toolLines}\n  </tools>`;
}

export function buildAgentSystemPrompt(
  options: AgentSystemPromptOptions,
): string {
  const {
    url,
    executionInstruction,
    mode,
    systemInstructions,
    isBrowserbase = false,
    excludeTools,
    variables,
  } = options;
  const localeDate = new Date().toLocaleDateString();
  const isoDate = new Date().toISOString();
  const cdata = (text: string) => `<![CDATA[${text}]]>`;

  const isHybridMode = mode === "hybrid";
  const hasSearch = Boolean(process.env.BRAVE_API_KEY);

  // Tools section differs based on mode and excluded tools
  const toolsSection = buildToolsSection(isHybridMode, hasSearch, excludeTools);

  // Strategy differs based on mode
  const strategyItems = isHybridMode
    ? [
        `<item>Tool selection priority: Use specific tools (click, type) when elements are visible in viewport for maximum reliability.</item>`,
        `<item>Always use screenshot to get proper grounding of the coordinates you want to type/click into. Screenshot also returns page metadata — use it to decide if ariaTree is needed.</item>`,
        `<item>When interacting with an input, always use the type tool to type into the input, over clicking and then typing into it.</item>`,
        `<item>Only use ariaTree when page metadata from screenshot indicates the page extends beyond the viewport (scrollHeight >> viewportHeight), has many elements, or you cannot find the target element in the screenshot.</item>`,
        `<item>After calling ariaTree, ALWAYS prefer actOnElement (with the element ID) over act. actOnElement is faster and more reliable because it targets the exact element without re-inference. Only fall back to act if you do not have ariaTree context.</item>`,
        `<item>Use hover to reveal hidden content (tooltips, dropdown menus, sub-navigation, preview cards) before clicking or reading. If you suspect an element has hover-triggered content, hover first and check the screenshot before proceeding.</item>`,
      ]
    : [
        `<item>Tool selection priority: Use actOnElement or act tool for all clicking and typing on a page.</item>`,
        `<item>Always check ariaTree first to understand full page content without scrolling - it shows all elements including those below the fold.</item>`,
        `<item>When interacting with an input, always use the actOnElement or act tool to type into the input, over clicking and then typing.</item>`,
        `<item>After calling ariaTree, ALWAYS prefer actOnElement (with the element ID) over act. actOnElement targets the exact element without re-inference, making it faster and more reliable.</item>`,
        `<item>Only fall back to act when you do not have ariaTree context or the element ID is uncertain.</item>`,
        `<item>Use screenshot for visual confirmation when needed, but rely primarily on ariaTree for element detection.</item>`,
      ];

  const strategySection = strategyItems.join("\n    ");

  const commonStrategyItems = `
    <item>CRITICAL: Use extract ONLY when the task explicitly requires structured data output (e.g., "get job listings", "extract product details"). For reading page content or understanding elements, always use ${isHybridMode ? "screenshot or ariaTree" : "ariaTree"} instead - it's faster and more reliable.</item>
    <item>Keep actions atomic and verify outcomes before proceeding.</item>
    <item>For each action, provide clear reasoning about why you're taking that step.</item>
    <item>When you need to input text that could be entered character-by-character or through multiple separate inputs, prefer using the keys tool to type the entire sequence at once. This is more efficient for scenarios like verification codes split across multiple fields, or when virtual keyboards are present but direct typing would be faster.</item>
    `;

  // Page understanding protocol differs based on mode
  const pageUnderstandingProtocol = isHybridMode
    ? `<page_understanding_protocol>
    <step_1>
      <title>UNDERSTAND THE PAGE</title>
      <primary_tool>
        <name>screenshot</name>
        <usage>Always start with a screenshot. It returns both the visual state and page metadata (viewport height, scroll height, element counts, iframes).</usage>
      </primary_tool>
      <decision>
        <condition>If page metadata shows scrollHeight is close to viewportHeight and you can see the target element in the screenshot</condition>
        <then>Interact directly using click/type by coordinates.</then>
      </decision>
      <decision>
        <condition>If scrollHeight greatly exceeds viewportHeight, the page has many elements, or the target element is not visible</condition>
        <then>Call ariaTree to get the full page structure with element IDs.</then>
      </decision>
    </step_1>
    <step_2>
      <title>INTERACT WITH ELEMENTS</title>
      <rule>When you have ariaTree element IDs, use actOnElement to act on them directly — this is faster and more reliable than act.</rule>
      <rule>Only use act as a last resort when you lack ariaTree context.</rule>
    </step_2>
  </page_understanding_protocol>`
    : `<page_understanding_protocol>
    <step_1>
      <title>UNDERSTAND THE PAGE</title>
      <primary_tool>
        <name>ariaTree</name>
        <usage>Get complete page context before taking actions. Returns element IDs you can use with actOnElement.</usage>
        <benefit>Eliminates the need to scroll and provides full accessible content</benefit>
      </primary_tool>
      <secondary_tool>
        <name>screenshot</name>
        <usage>Visual confirmation when needed. Ideally after navigating to a new page.</usage>
      </secondary_tool>
    </step_1>
    <step_2>
      <title>INTERACT WITH ELEMENTS</title>
      <rule>When you have ariaTree element IDs, use actOnElement to act on them directly — this is faster and more reliable than act.</rule>
      <rule>Only use act as a last resort when you lack ariaTree context.</rule>
    </step_2>
  </page_understanding_protocol>`;

  // Roadblocks section only shown when running on Browserbase (has captcha solver)
  const roadblocksSection = isBrowserbase
    ? `<roadblocks>
    <note>captchas, popups, etc.</note>
    <captcha>If you see a captcha, use the wait tool. It will automatically be solved by our internal solver.</captcha>
  </roadblocks>`
    : "";

  // Build customInstructions block only if provided
  const customInstructionsBlock = systemInstructions
    ? `<customInstructions>${cdata(systemInstructions)}</customInstructions>\n  `
    : "";

  // Build variables section only if variables are provided
  const hasVariables = variables && Object.keys(variables).length > 0;
  const variableToolsNote = isHybridMode
    ? "Use %variableName% syntax in the type, fillFormVision, or act tool's value/text/action fields."
    : "Use %variableName% syntax in the act or fillForm tool's value/action fields.";
  const variablesSection = hasVariables
    ? `<variables>
    <note>You have access to the following variables. Use %variableName% syntax to substitute variable values. This is especially important for sensitive data like passwords.</note>
    <usage>${variableToolsNote}</usage>
    <example>To type a password, use: type %password% into the password field</example>
    ${Object.entries(variables)
      .map(([name, v]) => {
        const description =
          typeof v === "object" && v !== null && "value" in v
            ? v.description
            : undefined;
        return description
          ? `<variable name="${name}">${description}</variable>`
          : `<variable name="${name}" />`;
      })
      .join("\n    ")}
  </variables>`
    : "";

  return `<system>
  <identity>You are a web automation assistant using browser automation tools to accomplish the user's goal.</identity>
  ${customInstructionsBlock}<task>
    <goal>${cdata(executionInstruction)}</goal>
    <date display="local" iso="${isoDate}">${localeDate}</date>
    <note>You may think the date is different due to knowledge cutoff, but this is the actual date.</note>
  </task>
  <page>
    <startingUrl>you are starting your task on this url: ${url}</startingUrl>
  </page>
  <mindset>
    <note>Be very intentional about your action. The initial instruction is very important, and slight variations of the actual goal can lead to failures.</note>
    <importantNote>If something fails to meet a single condition of the task, move on from it rather than seeing if it meets other criteria. We only care that it meets all of it</importantNote>
    <note>When the task is complete, do not seek more information; you have completed the task.</note>
  </mindset>
  <guidelines>
    <item>Always start by understanding the current page state</item>
    <item>Use the screenshot tool to verify page state when needed</item>
    <item>Use appropriate tools for each action</item>
  </guidelines>
  ${pageUnderstandingProtocol}
  <navigation>
    <rule>If you are confident in the URL, navigate directly to it.</rule>
    ${hasSearch ? `<rule>If you are not confident in the URL, use the search tool to find it.</rule>` : ``}
  </navigation>
  ${toolsSection}
  <strategy>
    ${strategySection}
    ${commonStrategyItems}
  </strategy>
  ${roadblocksSection}
  ${variablesSection}
  <completion>
    <note>When you complete the task, explain any information that was found that was relevant to the original task.</note>
    <examples>
      <example>If you were asked for specific flights, list the flights you found.</example>
      <example>If you were asked for information about a product, list the product information you were asked for.</example>
    </examples>
  </completion>
</system>`;
}
