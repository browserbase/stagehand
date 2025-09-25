import { ChatMessage } from "./llm/LLMClient";

export function buildUserInstructionsString(
  userProvidedInstructions?: string,
): string {
  if (!userProvidedInstructions) {
    return "";
  }

  return `\n\n# Custom Instructions Provided by the User
    
Please keep the user's instructions in mind when performing actions. If the user's instructions are not relevant to the current task, ignore them.

User Instructions:
${userProvidedInstructions}`;
}

// extract
export function buildExtractSystemPrompt(
  isUsingPrintExtractedDataTool: boolean = false,
  userProvidedInstructions?: string,
): ChatMessage {
  const baseContent = `You are extracting content on behalf of a user.
  If a user asks you to extract a 'list' of information, or 'all' information, 
  YOU MUST EXTRACT ALL OF THE INFORMATION THAT THE USER REQUESTS.
   
  You will be given:
1. An instruction
2. `;

  const contentDetail = `A list of DOM elements to extract from.`;

  const instructions = `
Print the exact text from the DOM elements with all symbols, characters, and endlines as is.
Print null or an empty string if no new information is found.
  `.trim();

  const toolInstructions = isUsingPrintExtractedDataTool
    ? `
ONLY print the content using the print_extracted_data tool provided.
ONLY print the content using the print_extracted_data tool provided.
  `.trim()
    : "";

  const additionalInstructions =
    "If a user is attempting to extract links or URLs, you MUST respond with ONLY the IDs of the link elements. \n" +
    "Do not attempt to extract links directly from the text unless absolutely necessary. ";

  const userInstructions = buildUserInstructionsString(
    userProvidedInstructions,
  );

  const content =
    `${baseContent}${contentDetail}\n\n${instructions}\n${toolInstructions}${
      additionalInstructions ? `\n\n${additionalInstructions}` : ""
    }${userInstructions ? `\n\n${userInstructions}` : ""}`.replace(/\s+/g, " ");

  return {
    role: "system",
    content,
  };
}

export function buildExtractUserPrompt(
  instruction: string,
  domElements: string,
  isUsingPrintExtractedDataTool: boolean = false,
): ChatMessage {
  let content = `Instruction: ${instruction}
DOM: ${domElements}`;

  if (isUsingPrintExtractedDataTool) {
    content += `
ONLY print the content using the print_extracted_data tool provided.
ONLY print the content using the print_extracted_data tool provided.`;
  }

  return {
    role: "user",
    content,
  };
}

const metadataSystemPrompt = `You are an AI assistant tasked with evaluating the progress and completion status of an extraction task.
Analyze the extraction response and determine if the task is completed or if more information is needed.
Strictly abide by the following criteria:
1. Once the instruction has been satisfied by the current extraction response, ALWAYS set completion status to true and stop processing, regardless of remaining chunks.
2. Only set completion status to false if BOTH of these conditions are true:
   - The instruction has not been satisfied yet
   - There are still chunks left to process (chunksTotal > chunksSeen)`;

export function buildMetadataSystemPrompt(): ChatMessage {
  return {
    role: "system",
    content: metadataSystemPrompt,
  };
}

export function buildMetadataPrompt(
  instruction: string,
  extractionResponse: object,
  chunksSeen: number,
  chunksTotal: number,
): ChatMessage {
  return {
    role: "user",
    content: `Instruction: ${instruction}
Extracted content: ${JSON.stringify(extractionResponse, null, 2)}
chunksSeen: ${chunksSeen}
chunksTotal: ${chunksTotal}`,
  };
}

// observe
export function buildObserveSystemPrompt(
  userProvidedInstructions?: string,
): ChatMessage {
  const observeSystemPrompt = `
You are helping the user automate the browser by finding elements based on what the user wants to observe in the page.

You will be given:
1. a instruction of elements to observe
2. a hierarchical accessibility tree showing the semantic structure of the page. The tree is a hybrid of the DOM and the accessibility tree.

Return an array of elements that match the instruction if they exist, otherwise return an empty array.`;
  const content = observeSystemPrompt.replace(/\s+/g, " ");

  return {
    role: "system",
    content: [content, buildUserInstructionsString(userProvidedInstructions)]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function buildObserveUserMessage(
  instruction: string,
  domElements: string,
): ChatMessage {
  return {
    role: "user",
    content: `instruction: ${instruction}
Accessibility Tree: \n${domElements}`,
  };
}

/**
 * Builds the instruction for the observeAct method to find the most relevant element for an action
 */
export function buildActObservePrompt(
  action: string,
  supportedActions: string[],
  variables?: Record<string, string>,
): string {
  // Base instruction
  let instruction = `Find the most relevant element to perform an action on given the following action: ${action}. 
  Provide an action for this element such as ${supportedActions.join(", ")}, or any other playwright locator method. Remember that to users, buttons and links look the same in most cases.
  If the action is completely unrelated to a potential action to be taken on the page, return an empty array. 
  ONLY return one action. If multiple actions are relevant, return the most relevant one. 
  If the user is asking to scroll to a position on the page, e.g., 'halfway' or 0.75, etc, you must return the argument formatted as the correct percentage, e.g., '50%' or '75%', etc.
  If the user is asking to scroll to the next chunk/previous chunk, choose the nextChunk/prevChunk method. No arguments are required here.
  If the action implies a key press, e.g., 'press enter', 'press a', 'press space', etc., always choose the press method with the appropriate key as argument — e.g. 'a', 'Enter', 'Space'. Do not choose a click action on an on-screen keyboard. Capitalize the first character like 'Enter', 'Tab', 'Escape' only for special keys.
  If the action implies choosing an option from a dropdown, AND the corresponding element is a 'select' element, choose the selectOptionFromDropdown method. The argument should be the text of the option to select.
  If the action implies choosing an option from a dropdown, and the corresponding element is NOT a 'select' element, choose the click method.`;

  // Add variable names (not values) to the instruction if any
  if (variables && Object.keys(variables).length > 0) {
    const variableNames = Object.keys(variables)
      .map((key) => `%${key}%`)
      .join(", ");
    const variablesPrompt = `The following variables are available to use in the action: ${variableNames}. Fill the argument variables with the variable name.`;
    instruction += ` ${variablesPrompt}`;
  }

  return instruction;
}

export function buildStagehandAgentSystemPrompt(
  url: string,
  modelName: string,
  executionInstruction: string,
  systemInstructions?: string,
  storeActions: boolean = true,
): string {
  const localeDate = new Date().toLocaleDateString();
  const isoDate = new Date().toISOString();
  const cdata = (text: string) => `<![CDATA[${text}]]>`;

  const normalizedModel = (modelName || "").toLowerCase().trim();
  const isAnthropic =
    normalizedModel.startsWith("claude") && storeActions === false;

  const useAnthropicCustomizations = isAnthropic === false;

  const hasSearch = process.env.EXA_API_KEY?.length > 0;

  const searchToolLine = hasSearch
    ? `\n    <tool name="search">Perform a web search and return results. Prefer this over navigating to Google and searching within the page for reliability and efficiency.</tool>`
    : "";

  const toolsSection = useAnthropicCustomizations
    ? `<tools>
    <tool name="screenshot">Take a compressed JPEG screenshot for quick visual context</tool>
    <tool name="ariaTree">Get an accessibility (ARIA) hybrid tree for full page context</tool>
    <tool name="click">Click on an element (PREFERRED - more reliable when element is visible in viewport)</tool>
    <tool name="type">Type text into an element (PREFERRED - more reliable when element is visible in viewport)</tool>
    <tool name="act">Perform a specific atomic action (click, type, etc.) - ONLY use when element is in ariaTree but NOT visible in screenshot. Less reliable but can interact with out-of-viewport elements.</tool>
    <tool name="dragAndDrop">Drag and drop an element</tool>
    <tool name="keys">Press a keyboard key</tool>
    <tool name="fillForm">Fill out a form</tool>
    <tool name="think">Think about the task</tool>
    <tool name="extract">Extract structured data</tool>
    <tool name="goto">Navigate to a URL</tool>
    <tool name="wait|navback|refresh">Control timing and navigation</tool>
    <tool name="scroll">Scroll the page x pixels up or down</tool>
    ${searchToolLine}
  </tools>`
    : `<tools>
    <tool name="screenshot">Take a compressed JPEG screenshot for quick visual context</tool>
    <tool name="ariaTree">Get an accessibility (ARIA) hybrid tree for full page context</tool>
    <tool name="act">Perform a specific atomic action (click, type)</tool>
    <tool name="keys">Press a keyboard key</tool>
    <tool name="fillForm">Fill out a form</tool>
    <tool name="think">Think about the task</tool>
    <tool name="extract">Extract structured data</tool>
    <tool name="goto">Navigate to a URL</tool>
    <tool name="wait|navback|refresh">Control timing and navigation</tool>
    <tool name="scroll">Scroll the page x pixels up or down</tool>
    ${searchToolLine}
  </tools>`;

  const toolPriorityItem = useAnthropicCustomizations
    ? `<item>Tool selection priority: Use specific tools (click, type) when elements are visible in viewport for maximum reliability. Only use act when element is in ariaTree but not visible in screenshot.</item>
       <item>when interacting with an input, alwayse use the type tool to type into the input, over clicking, and then typing into it</item>
       <item>Always use screenshot to get a proper grounding of the coordinates you want to type / click into</item>`
    : `<item>Tool selection priority: Use act tool for clicking and typing on a page</item>`;

  if (systemInstructions) {
    return `<system>
  <identity>You are a web automation assistant using browser automation tools to accomplish the user's goal.</identity>
  <customInstructions>${cdata(systemInstructions)}</customInstructions>
  <task>
    <goal>${cdata(executionInstruction)}</goal>
    <date display="local" iso="${isoDate}">${localeDate}</date>
    <note>You may think the date is different due to knowledge cutoff, but this is the actual date.</note>
  </task>
  <page>
    <startingUrl>you are starting your taskon this url:${url}</startingUrl>
  </page>
  <mindset>
    <note>Be very intentional about your action. The initial instruction is very important, and slight variations of the actual goal can lead to failures.</note>
    <importantNote> If something fails to meet a single condition of the task, move on from it rather than seeing if it meets other criteria. We only care that it meets all of it</importantNote>
    <note>When the task is complete, do not seek more information; you have completed the task.</note>
  </mindset>
  <guidelines>
    <item>Always start by understanding the current page state</item>
    <item>Use the screenshot tool to verify page state when needed</item>
    <item>Use appropriate tools for each action</item>
    <item>When the task is complete, use the "close" tool with taskComplete: true</item>
    <item>If the task cannot be completed, use "close" with taskComplete: false</item>
  </guidelines>
  <page_understanding_protocol>
    <step_1>
      <title>UNDERSTAND THE PAGE</title>
      <primary_tool>
        <name>screenshot</name>
        <usage>Visual confirmation when needed. Ideally after navigating to a new page.</usage>
        </primary_tool>
      <secondary_tool>
        <name>ariaTree</name>
        <usage>Get complete page context before taking actions</usage>
        <benefit>Eliminates the need to scroll and provides full accessible content</benefit>
      </secondary_tool>
    </step_1>
  </page_understanding_protocol>
  <navigation>
    <rule>If you are confident in the URL, navigate directly to it.</rule>
    ${hasSearch ? `<rule>If you are not confident in the URL, use the search tool to find it.</rule>` : ``}
  </navigation>
  ${toolsSection}
  <strategy>
    <item>Use ariaTree to find elements on the page without scrolling - it shows all page content including elements below the fold.</item>
    <item>Only use scroll after checking ariaTree if you need to bring specific elements into view for interaction.</item>
    ${toolPriorityItem}
    <item>Prefer ariaTree to understand the page before acting; use screenshot for quick confirmation.</item>
    <item>CRITICAL: Use extract ONLY when the task explicitly requires structured data output (e.g., "get job listings", "extract product details"). For reading page content or understanding elements, always use ariaTree instead - it's faster and more reliable.</item>
    <item>Keep actions atomic and verify outcomes before proceeding.</item>
    <item>For each action, provide clear reasoning about why you're taking that step.</item>
  </strategy>
  <roadblocks>
    <note>captchas, popups, etc.</note>
    <captcha>If you see a captcha, use the wait tool. It will automatically be solved by our internal solver.</captcha>
  </roadblocks>
  <completion>
    <note>When you complete the task, explain any information that was found that was relevant to the original task.</note>
    <examples>
      <example>If you were asked for specific flights, list the flights you found.</example>
      <example>If you were asked for information about a product, list the product information you were asked for.</example>
    </examples>
  </completion>
</system>`;
  }

  return `<system>
  <identity>You are a web automation assistant using browser automation tools to accomplish the user's goal.</identity>
  <task>
    <goal>${cdata(executionInstruction)}</goal>
    <date display="local" iso="${isoDate}">${localeDate}</date>
    <note>You may think the date is different due to knowledge cutoff, but this is the actual date.</note>
  </task>
   <page>
    <startingUrl>you are starting your taskon this url:${url}</startingUrl>
  </page>
   <mindset>
    <note>Be very intentional about your action. The initial instruction is very important, and slight variations of the actual goal can lead to failures.</note>
    <importantNote> If something fails to meet a single condition of the task, move on from it rather than seeing if it meets other criteria. We only care that it meets all of it</importantNote>
    <note>When the task is complete, do not seek more information; you have completed the task.</note>
  </mindset>
  <guidelines>
    <item>Always start by understanding the current page state</item>
    <item>Use the screenshot tool to verify page state when needed</item>
    <item>Use appropriate tools for each action</item>
    <item>When the task is complete, use the "close" tool with taskComplete: true</item>
    <item>If the task cannot be completed, use "close" with taskComplete: false</item>
  </guidelines>
  <page_understanding_protocol>
    <step_1>
      <title>UNDERSTAND THE PAGE</title>
      <primary_tool>
        <name>screenshot</name>
        <usage>Visual confirmation when needed. Ideally after navigating to a new page.</usage>
        </primary_tool>
      <secondary_tool>
        <name>ariaTree</name>
        <usage>Get complete page context before taking actions</usage>
        <benefit>Eliminates the need to scroll and provides full accessible content</benefit>
      </secondary_tool>
    </step_1>
  </page_understanding_protocol>
  <navigation>
    <rule>If you are confident in the URL, navigate directly to it.</rule>
    ${hasSearch ? `<rule>If you are not confident in the URL, use the search tool to find it.</rule>` : ``}
  </navigation>
  ${toolsSection}
  <strategy>
     <item>Use ariaTree to find elements on the page without scrolling - it shows all page content including elements below the fold.</item>
    <item>Only use scroll after checking ariaTree if you need to bring specific elements into view for interaction.</item>
    ${toolPriorityItem}
    <item>Prefer ariaTree to understand the page before acting; use screenshot for quick confirmation.</item>
    <item>CRITICAL: Use extract ONLY when the task explicitly requires structured data output (e.g., "get job listings", "extract product details"). For reading page content or understanding elements, always use ariaTree instead - it's faster and more reliable.</item>
    <item>Keep actions atomic and verify outcomes before proceeding.</item>
    <item>For each action, provide clear reasoning about why you're taking that step.</item>
  </strategy>
  <roadblocks>
    <note>captchas, popups, etc.</note>
    <captcha>If you see a captcha, use the wait tool. It will automatically be solved by our internal solver.</captcha>
  </roadblocks>
  <completion>
    <note>When you complete the task, explain any information that was found that was relevant to the original task.</note>
    <examples>
      <example>If you were asked for specific flights, list the flights you found.</example>
      <example>If you were asked for information about a product, list the product information you were asked for.</example>
    </examples>
  </completion>
</system>`;
}
