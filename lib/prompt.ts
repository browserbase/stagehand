import OpenAI from "openai";

// act
const actSystemPrompt = `
# Instructions
You are a browser automation assistant. Your job is to accomplish the user's goal across multiple model calls.

You are given:
1. the user's overall goal
2. the steps that you've taken so far
3. a list of active DOM elements in this chunk to consider to get closer to the goal. 

You have 2 tools that you can call: doAction, and skipSection. Do action only performs Playwright actions. Do not perform any other actions.

Note: If there is a popup on the page for cookies or advertising that has nothing to do with the goal, try to close it first before proceeding. As this can block the goal from being completed.

Also, verify if the goal has been accomplished already. Do this by checking if the goal has been accomplished based on the previous steps completed, the current page DOM elements and the current page URL / starting page URL. If it has, set completed to true and finish the task.

Do exactly what the user's goal is. Do not exceed the scope of the goal.
`;

const verifyActCompletionSystemPrompt = `
You are a browser automation assistant. The job has given you a goal and a list of steps that have been taken so far. Your job is to determine if the user's goal has been completed based on the provided information.

# Input
You will receive:
1. The user's goal: A clear description of what the user wants to achieve.
2. Steps taken so far: A list of actions that have been performed up to this point.
3. An image of the current page

# Your Task
Analyze the provided information to determine if the user's goal has been fully completed.

# Output
Return a boolean value:
- true: If the goal has been definitively completed based on the steps taken and the current page.
- false: If the goal has not been completed or if there's any uncertainty about its completion.

# Important Considerations
- False positives are okay. False negatives are not okay.
- Look for evidence of errors on the page or something having gone wrong in completing the goal. If one does not exist, return true.
`;

// ## Examples for completion check
// ### Example 1
// 1. User's goal: "input data scientist into role"
// 2. Steps you've taken so far: "The role input field was filled with 'data scientist'."
// 3. Active DOM elements: ["<input id="c9" class="VfPpkd-fmcmS-wGMbrd " aria-expanded="false" data-axe="mdc-autocomplete">data scientist</input>", "<button class="VfPpkd-LgbsSe VfPpkd-LgbsSe-OWXEXe-INsAgc lJ9FBc nDgy9d" type="submit">Search</button>"]

// Output: Will need to have completed set to true. Nothing else matters.
// Reasoning: The goal the user set has already been accomplished. We should not take any extra actions outside of the scope of the goal (for example, clicking on the search button is an invalid action - ie: not acceptable).

// ### Example 2
// 1. User's goal: "Sign up for the newsletter"
// 2. Steps you've taken so far: ["The email input field was filled with 'test@test.com'."]
// 3. Active DOM elements: ["<input type='email' id='newsletter-email' placeholder='Enter your email'></input>", "<button id='subscribe-button'>Subscribe</button>"]

// Output: Will need to have click on the subscribe button as action. And completed set to false.
// Reasoning: There might be an error when trying to submit the form and you need to make sure the goal is accomplished properly. So you set completed to false.

export function buildVerifyActCompletionSystemPrompt(): OpenAI.ChatCompletionMessageParam {
  return {
    role: "system",
    content: verifyActCompletionSystemPrompt,
  };
}

export function buildVerifyActCompletionUserPrompt(
  goal: string,
  steps = "None",
  domElements: string | undefined,
): OpenAI.ChatCompletionMessageParam {
  let actUserPrompt = `
# My Goal
${goal}

# Steps You've Taken So Far
${steps}
`;

  if (domElements) {
    actUserPrompt += `
# Active DOM Elements on the current page
${domElements}
`;
  }

  return {
    role: "user",
    content: actUserPrompt,
  };
}

export function buildActSystemPrompt(): OpenAI.ChatCompletionMessageParam {
  return {
    role: "system",
    content: actSystemPrompt,
  };
}

export function buildActUserPrompt(
  action: string,
  steps = "None",
  domElements: string,
): OpenAI.ChatCompletionMessageParam {
  const actUserPrompt = `
# My Goal
${action}

# Steps You've Taken So Far
${steps}

# Current Active Dom Elements
${domElements}
`;

  return {
    role: "user",
    content: actUserPrompt,
  };
}

export const actTools: Array<OpenAI.ChatCompletionTool> = [
  {
    type: "function",
    function: {
      name: "doAction",
      description:
        "execute the next playwright step that directly accomplishes the goal",
      parameters: {
        type: "object",
        required: ["method", "element", "args", "step", "completed"],
        properties: {
          method: {
            type: "string",
            description: "The playwright function to call.",
          },
          element: {
            type: "number",
            description: "The element number to act on",
          },
          args: {
            type: "array",
            description: "The required arguments",
            items: {
              type: "string",
              description: "The argument to pass to the function",
            },
          },
          step: {
            type: "string",
            description:
              "human readable description of the step that is taken in the past tense. Please be very detailed.",
          },
          why: {
            type: "string",
            description:
              "why is this step taken? how does it advance the goal?",
          },
          completed: {
            type: "boolean",
            description:
              "true if the goal should be accomplished after this step",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skipSection",
      description:
        "skips this area of the webpage because the current goal cannot be accomplished here",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "reason that no action is taken",
          },
        },
      },
    },
  },
];

// extract
const extractSystemPrompt = `You are extracting content on behalf of a user. You will be given:
1. An instruction
2. A list of DOM elements to extract from

Return the exact text from the DOM elements with all symbols, characters, and endlines as is.
Only extract new information that has not already been extracted. Return null or an empty string if no new information is found.`;

export function buildExtractSystemPrompt(): OpenAI.ChatCompletionMessageParam {
  const content = extractSystemPrompt.replace(/\s+/g, " ");
  return {
    role: "system",
    content,
  };
}

export function buildExtractUserPrompt(
  instruction: string,
  domElements: string,
): OpenAI.ChatCompletionMessageParam {
  return {
    role: "user",
    content: `Instruction: ${instruction}
    DOM: ${domElements}
    Extracted content:`,
  };
}

const refineSystemPrompt = `You are tasked with refining and filtering information for the final output based on newly extracted and previously extracted content. Your responsibilities are:
1. Remove exact duplicates for elements in arrays and objects.
2. For text fields, append or update relevant text if the new content is an extension, replacement, or continuation.
3. For non-text fields (e.g., numbers, booleans), update with new values if they differ.
4. Add any completely new fields or objects.

Return the updated content that includes both the previous content and the new, non-duplicate, or extended information.`;

export function buildRefineSystemPrompt() {
  return {
    role: "system",
    content: refineSystemPrompt,
  };
}

export function buildRefineUserPrompt(
  instruction: string,
  previouslyExtractedContent: object,
  newlyExtractedContent: object,
) {
  return {
    role: "user",
    content: `Instruction: ${instruction}
Previously extracted content: ${JSON.stringify(previouslyExtractedContent, null, 2)}
Newly extracted content: ${JSON.stringify(newlyExtractedContent, null, 2)}
Refined content:`,
  };
}

const metadataSystemPrompt = `You are an AI assistant tasked with evaluating the progress and completion status of an extraction task.
Analyze the extraction response and determine if the task is completed or if more information is needed.

Strictly abide by the following criteria:
1. If you are certain that the instruction is completed, set the completion status to true, even if there are still chunks left.
2. If there could still be more information to extract and there are still chunks left, set the completion status to false.`;

export function buildMetadataSystemPrompt() {
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
) {
  return {
    role: "user",
    content: `Instruction: ${instruction}
Extracted content: ${JSON.stringify(extractionResponse, null, 2)}
Chunks seen: ${chunksSeen}
Chunks total: ${chunksTotal}`,
  };
}

// observe
const observeSystemPrompt = `
You are helping the user automate the browser by finding a playwright locator string. You will be given a instruction of the element to find, and a numbered list of possible elements.

return only element id we are looking for.

if the element is not found, return NONE.
`;
export function buildObserveSystemPrompt(): OpenAI.ChatCompletionMessageParam {
  const content = observeSystemPrompt.replace(/\s+/g, " ");

  return {
    role: "system",
    content,
  };
}

export function buildObserveUserMessage(
  observation: string,
  domElements: string,
): OpenAI.ChatCompletionMessageParam {
  return {
    role: "user",
    content: `instruction: ${observation}
    DOM: ${domElements}`,
  };
}

// ask
const askSystemPrompt = `
you are a simple question answering assistent given the user's question. respond with only the answer.
`;
export function buildAskSystemPrompt(): OpenAI.ChatCompletionMessageParam {
  return {
    role: "system",
    content: askSystemPrompt,
  };
}

export function buildAskUserPrompt(
  question: string,
): OpenAI.ChatCompletionMessageParam {
  return {
    role: "user",
    content: `question: ${question}`,
  };
}
