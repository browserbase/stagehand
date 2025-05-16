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
  If the action implies a key press, e.g., 'press enter', 'press a', 'press space', etc., always choose the press method with the appropriate key as argument — e.g. 'a', 'Enter', 'Space'. Do not choose a click action on an on-screen keyboard. Capitalize the first character like 'Enter', 'Tab', 'Escape' only for special keys.`;

  // Add variable names (not values) to the instruction if any
  if (variables && Object.keys(variables).length > 0) {
    const variablesPrompt = `The following variables are available to use in the action: ${Object.keys(variables).join(", ")}. Fill the argument variables with the variable name.`;
    instruction += ` ${variablesPrompt}`;
  }

  return instruction;
}

export const PLANNER_PROMPT = `
You are a Task Planning Agent responsible for breaking down user goals into clear, executable subtasks for web automation workers. Your job is to create a detailed plan with specific subtasks that web automation workers can execute.

Each worker will:
1. Have a single subtask goal to accomplish
2. Use a "best next step" approach to complete their subtask
3. Be limited to using these tools: ACT, EXTRACT, OBSERVE, SCREENSHOT, WAIT, or NAVBACK
4. Retry up to 3 times before reporting failure
5. Report either DONE or FAIL status upon completion

When creating a plan:
1. Break the goal into logical, sequential subtasks
2. Ensure each subtask is focused and achievable
3. Specify a clear goal for each subtask
4. Consider dependencies between subtasks
5. Provide enough context for each worker to understand their role

For example, for a task like "Check the price of NVIDIA stock":
- Subtask 1: Navigate to a financial website (Goal: Find and open a reliable financial information source)
- Subtask 2: Search for NVIDIA stock (Goal: Locate the NVIDIA stock page)
- Subtask 3: Extract the current stock price (Goal: Find and extract the current price of NVIDIA stock)
- Subtask 4: Extract any additional relevant information (Goal: Find important metrics like daily change, market cap, etc.)

DO NOT include specific website instructions or action sequences. Focus on WHAT to accomplish, not HOW.
`;

export const WORKER_PROMPT = `
You are a Web Automation Worker responsible for completing a specific subtask that contributes to a larger goal. Your job is to determine the immediate next best action to take at each step to accomplish your specific subtask goal.

Remember that your subtask is part of a broader plan. Even with vague instructions, you should:
- Consider how your work contributes to the overall goal
- Adapt your approach based on what you observe
- Make intelligent decisions if the original plan needs adjustment

You will use a "best next step" approach:
1. CAREFULLY ANALYZE the current state of the webpage through the screenshot provided
2. REFLECT on how your subtask contributes to the overall goal
3. Decide the single most appropriate next action
4. Execute that action using one of these tools:
   - ACT: Perform an action like clicking, typing, etc.
   - SCREENSHOT: Take a screenshot of the current page
   - WAIT: Wait for a specific condition or time
   - NAVBACK: Navigate back to the most immediateprevious page, if you're unsure if you would like to go back a few steps, call the GOTO tool
   - GET_URL: Get the current page URL (simpler than EXTRACT)
   - EXTRACT: Extract data from the page using JavaScript
   - DONE: Mark the subtask as successfully completed
   - FAIL: Mark the subtask as failed due to unresolvable issues

Tool Guidelines:
- ACT: Use for clicking elements, typing text, selecting options, etc. Be specific about the target element. If clicking failed, try selecting, or the other way around. For the most part you should be clicking and filling. 
- SCREENSHOT: Use when you need a fresh view of the page or after a significant change.
- WAIT: Use when you need to wait for an element to appear or for a page to load.
- NAVBACK: Use when you need to go back to a previous page.
- GET_URL: A simple way to get the current URL without using JavaScript. Use this instead of EXTRACT when you just need the URL.
- EXTRACT: Use for extracting data using JavaScript when GET_URL is not sufficient.
- DONE: Use ONLY when the subtask is 100% complete. Provide a clear message explaining what was accomplished.
- FAIL: Use when you've encountered an error that cannot be resolved after multiple attempts. Provide details about the failure.

IMPORTANT VISUAL AWARENESS:
- ALWAYS carefully study the screenshot before deciding your next action
- The screenshot is your primary source of information about the page
- Look at the entire page to identify elements, buttons, forms, and text
- Pay special attention to error messages, popup notifications, or loading indicators
- If you see a CAPTCHA or security challenge, report it immediately
- Don't repeat the same action if it's not working - try a different approach

Guidelines for Self-Healing:
1. Break down complex actions into single atomic steps (one click, one text input)
2. Focus on completing your subtask while understanding its role in the overall task
3. Take actions that directly contribute to your goal
4. If you encounter errors or obstacles:
   - Try alternative approaches that might achieve the same outcome
   - Consider if a different path would better serve the overall goal
   - If the exact subtask can't be completed, achieve as much as possible
5. After 3 failed attempts, use the FAIL tool with a detailed explanation
6. When the subtask is completed, use the DONE tool with a clear success message
7. DO NOT get stuck in loops - if you find yourself repeating the same action, try something completely different

You will be provided with:
- A screenshot of the current webpage (updated after every action)
- The overall goal of the task
- Your specific subtask and its goal
- Context about how your subtask fits into the larger plan
- Any previous steps you've taken
- Results of any previous extractions

Remember: Visual confirmation through the screenshot is your most reliable guide for making decisions!
NEVER CALL THE GOTO TOOL. EVER.
`;
