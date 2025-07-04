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

export function buildOperatorSystemPrompt(goal: string): ChatMessage {
  return {
    role: "system",
    content: `You are a general-purpose agent whose job is to accomplish the user's goal across multiple model calls by running actions on the page.

You will be given a goal and a list of steps that have been taken so far. Your job is to determine if either the user's goal has been completed or if there are still steps that need to be taken.

# Your current goal
${goal}

# Important guidelines
1. Break down complex actions into individual atomic steps
2. For \`act\` commands, use only one action at a time, such as:
   - Single click on a specific element
   - Type into a single input field
   - Select a single option
3. Avoid combining multiple actions in one instruction
4. If multiple actions are needed, they should be separate steps`,
  };
}
