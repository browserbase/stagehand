import { AvailableModel } from "./LLMProvider";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | {
        type: "image_url" | "text";
        image_url?: { url: string };
        text?: string;
      }[];
}

export const modelsWithVision: AvailableModel[] = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet-20241022",
  "gpt-4o-2024-08-06",
];

export const AnnotatedScreenshotText =
  "This is a screenshot of the current page state with the elements annotated on it. Each element id is annotated with a number to the top left of it. Duplicate annotations at the same location are under each other vertically.";

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  image?: {
    buffer: Buffer;
    description?: string;
  };
  [key: string]: any; // Additional provider-specific options
  response_model?: {
    name: string;
    schema: any;
  };
}

export interface LLMClient {
  createChatCompletion(options: ChatCompletionOptions): Promise<any>;
  logger: (message: { category?: string; message: string }) => void;
}
