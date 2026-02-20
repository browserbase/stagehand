import { ChatMessage } from "./v3/llm/LLMClient.js";
import type { Variables } from "./v3/types/public/agent.js";

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
): ChatMessage {
  return {
    role: "user",
    content: `Instruction: ${instruction}
Extracted content: ${JSON.stringify(extractionResponse, null, 2)}`,
  };
}

// observe
export function buildObserveSystemPrompt(
  userProvidedInstructions?: string,
  supportedActions?: string[],
): ChatMessage {
  const actionsString = supportedActions?.length
    ? `\n\nSupported actions: ${supportedActions.join(", ")}`
    : "";

  const observeSystemPrompt = `
You are helping the user automate the browser by finding elements based on what the user wants to observe in the page.

You will be given:
1. a instruction of elements to observe
2. a hierarchical accessibility tree showing the semantic structure of the page. The tree is a hybrid of the DOM and the accessibility tree.

Return an array of elements that match the instruction if they exist, otherwise return an empty array.
When returning elements, include the appropriate method from the supported actions list.${actionsString}. When choosing non-left click actions, provide right or middle as the argument.`;
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
Accessibility Tree: \n${domElements}\n`,
  };
}

export function buildActSystemPrompt(
  userProvidedInstructions?: string,
): ChatMessage {
  const actSystemPrompt = `
You are helping the user automate the browser by finding elements based on what action the user wants to take on the page

You will be given:
1. a user defined instruction about what action to take
2. a hierarchical accessibility tree showing the semantic structure of the page. The tree is a hybrid of the DOM and the accessibility tree.

Return the element that matches the instruction if it exists. Otherwise, return an empty object.`;
  const content = actSystemPrompt.replace(/\s+/g, " ");

  return {
    role: "system",
    content: [content, buildUserInstructionsString(userProvidedInstructions)]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function buildActPrompt(
  action: string,
  supportedActions: string[],
  variables?: Variables,
): string {
  // Base instruction
  let instruction = `Find the most relevant element to perform an action on given the following action: ${action}.  
  IF AND ONLY IF the action EXPLICITLY includes the word 'dropdown' and implies choosing/selecting an option from a dropdown, ignore the 'General Instructions' section, and follow the 'Dropdown Specific Instructions' section carefully.
  
  General Instructions: 
    Provide an action for this element such as ${supportedActions.join(", ")}. Remember that to users, buttons and links look the same in most cases.
    When choosing non-left click actions, provide right or middle as the argument
    If the action is completely unrelated to a potential action to be taken on the page, return an empty object. 
    ONLY return one action. If multiple actions are relevant, return the most relevant one. 
    If the user is asking to scroll to a position on the page, e.g., 'halfway' or 0.75, etc, you must return the argument formatted as the correct percentage, e.g., '50%' or '75%', etc.
    If the user is asking to scroll to the next chunk/previous chunk, choose the nextChunk/prevChunk method. No arguments are required here.
    If the action implies a key press, e.g., 'press enter', 'press a', 'press space', etc., always choose the press method with the appropriate key as argument — e.g. 'a', 'Enter', 'Space'. Do not choose a click action on an on-screen keyboard. Capitalize the first character like 'Enter', 'Tab', 'Escape' only for special keys. 
  
  Dropdown Specific Instructions:
    For interacting with dropdowns, there are two specific cases that you need to handle. 
    
    CASE 1: the element is a 'select' element. 
      - choose the selectOptionFromDropdown method,
      - set the argument to the exact text of the option that should be selected,
      - set twoStep to false.
    CASE 2: the element is NOT a 'select' element:
      - do not attempt to directly choose the element from the dropdown. You will need to click to expand the dropdown first. You will achieve this by following these instructions:
        - choose the node that most closely corresponds to the given instruction EVEN if it is a 'StaticText' element, or otherwise does not appear to be interactable.  
        - choose the 'click' method
        - set twoStep to true.
  `;

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

export function buildStepTwoPrompt(
  originalUserAction: string,
  previousAction: string,
  supportedActions: string[],
  variables?: Variables,
): string {
  // Base instruction
  let instruction = `
  The original user action was: ${originalUserAction}.
  You have just taken the following action which completed step 1 of 2: ${previousAction}.
  
  Now, you must find the most relevant element to perform an action on in order to complete step 2 of 2. 
  
  General Instructions: 
  Provide an action for this element such as ${supportedActions.join(", ")}. Remember that to users, buttons and links look the same in most cases.
  If the action is completely unrelated to a potential action to be taken on the page, return an empty object. 
  ONLY return one action. If multiple actions are relevant, return the most relevant one. 
  If the user is asking to scroll to a position on the page, e.g., 'halfway' or 0.75, etc, you must return the argument formatted as the correct percentage, e.g., '50%' or '75%', etc.
  If the user is asking to scroll to the next chunk/previous chunk, choose the nextChunk/prevChunk method. No arguments are required here.
  If the action implies a key press, e.g., 'press enter', 'press a', 'press space', etc., always choose the press method with the appropriate key as argument — e.g. 'a', 'Enter', 'Space'. Do not choose a click action on an on-screen keyboard. Capitalize the first character like 'Enter', 'Tab', 'Escape' only for special keys. 
  `;

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

export function buildOperatorSystemPrompt(goal: string): ChatMessage {
  return {
    role: "system",
    content: `You are a general-purpose agent whose job is to accomplish the user's goal across multiple model calls by running actions on the page.

You will be given a goal and a list of steps that have been taken so far. Your job is to determine if either the user's goal has been completed or if there are still steps that need to be taken.

# Your current goal
${goal}

# CRITICAL: You MUST use the provided tools to take actions. Do not just describe what you want to do - actually call the appropriate tools.

# Available tools and when to use them:
- \`act\`: Use this to interact with the page (click, type, navigate, etc.)
- \`extract\`: Use this to get information from the page
- \`goto\`: Use this to navigate to a specific URL
- \`wait\`: Use this to wait for a period of time
- \`navback\`: Use this to go back to the previous page
- \`refresh\`: Use this to refresh the current page
- \`close\`: Use this ONLY when the task is complete or cannot be achieved
- External tools: Use any additional tools (like search tools) as needed for your goal

# Important guidelines
1. ALWAYS use tools - never just provide text responses about what you plan to do
2. Break down complex actions into individual atomic steps
3. For \`act\` commands, use only one action at a time, such as:
   - Single click on a specific element
   - Type into a single input field
   - Select a single option
4. Avoid combining multiple actions in one instruction
5. If multiple actions are needed, they should be separate steps
6. Only use \`close\` when the task is genuinely complete or impossible to achieve`,
  };
}

export function buildCuaDefaultSystemPrompt(): string {
  return `You are a helpful assistant that can use a web browser.\nDo not ask follow up questions, the user will trust your judgement. Today's date is ${new Date().toISOString().split("T")[0]}.`;
}

export function buildGoogleCUASystemPrompt(): ChatMessage {
  return {
    role: "system",
    content: `You are a general-purpose browser agent whose job is to accomplish the user's goal.
Today's date is ${new Date().toISOString().split("T")[0]}.
You have access to a search tool; however, in most cases you should operate within the page/url the user has provided. ONLY use the search tool if you're stuck or the task is impossible to complete within the current page.
You will be given a goal and a list of steps that have been taken so far. Avoid requesting the user for input as much as possible. Good luck!
`,
  };
}
