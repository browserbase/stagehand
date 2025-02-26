import { Stagehand } from "../lib";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { LLMClient, CreateChatCompletionOptions } from "../lib/llm/LLMClient";
import { AvailableModel, ClientOptions } from "../types/model";

// Create a mock LLM client that returns a fixed response
class MockLLMClient extends LLMClient {
  public type: "openai" | "anthropic" | string = "mock";
  public modelName: AvailableModel = "mock-model" as AvailableModel;
  public hasVision: boolean = false;
  public clientOptions: ClientOptions = {};

  constructor() {
    super("mock-model" as AvailableModel);
  }

  async createChatCompletion<T>(options: CreateChatCompletionOptions): Promise<T> {
    // Log that we're using a mock client
    options.logger({
      category: "llm",
      message: "Using mock LLM client",
      level: 1
    });

    // Return a mock extraction result
    return {
      id: "mock-id",
      object: "chat.completion",
      created: Date.now(),
      model: "mock-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({
              sections: [
                {
                  title: "Language Tag Characters (U+E0001, U+E0020-U+E007F)",
                  content: [
                    "This text contains language tag characters: Hello \u{E0001}W\u{E0020}o\u{E0030}r\u{E0040}l\u{E0050}d\u{E0060}",
                    "These characters are invisible but can be used for prompt injection.",
                    "This is normal text without language tag characters: Hello World"
                  ]
                },
                {
                  title: "Emoji Variation Selectors (U+FE00-U+FE0F)",
                  content: [
                    "Text with emoji variation selectors: A\uFE00 B\uFE05 C\uFE0F",
                    "Emoji with variation selector: ☺\uFE0F (smiling face with presentation selector)",
                    "Normal text without variation selectors: A B C",
                    "Normal emoji: ☺"
                  ]
                },
                {
                  title: "Supplementary Variation Selectors (U+E0100-U+E01EF)",
                  content: [
                    "Text with supplementary variation selectors: X\u{E0100} Y\u{E0120} Z\u{E0140}",
                    "Normal text without supplementary variation selectors: X Y Z"
                  ]
                }
              ]
            }),
            tool_calls: []
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    } as unknown as T;
  }

  async complete(options: any): Promise<any> {
    return {
      sections: [
        {
          title: "Language Tag Characters (U+E0001, U+E0020-U+E007F)",
          content: [
            "This text contains language tag characters: Hello \u{E0001}W\u{E0020}o\u{E0030}r\u{E0040}l\u{E0050}d\u{E0060}",
            "These characters are invisible but can be used for prompt injection.",
            "This is normal text without language tag characters: Hello World"
          ]
        },
        {
          title: "Emoji Variation Selectors (U+FE00-U+FE0F)",
          content: [
            "Text with emoji variation selectors: A\uFE00 B\uFE05 C\uFE0F",
            "Emoji with variation selector: ☺\uFE0F (smiling face with presentation selector)",
            "Normal text without variation selectors: A B C",
            "Normal emoji: ☺"
          ]
        },
        {
          title: "Supplementary Variation Selectors (U+E0100-U+E01EF)",
          content: [
            "Text with supplementary variation selectors: X\u{E0100} Y\u{E0120} Z\u{E0140}",
            "Normal text without supplementary variation selectors: X Y Z"
          ]
        }
      ]
    };
  }
}

// Schema for extraction
const TestPageSchema = z.object({
  sections: z.array(z.object({
    title: z.string(),
    content: z.array(z.string())
  }))
});

type TestPageData = z.infer<typeof TestPageSchema>;

// Helper function to print code points
function printCodePoints(str: string): string {
  return Array.from(str).map(char => {
    const cp = char.codePointAt(0);
    if (!cp) return '';
    return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  }).join(', ');
}

async function runTest() {
  console.log("Starting Stagehand Unicode filtering test...");
  
  // Create HTML file path
  const htmlPath = path.join(process.cwd(), "examples", "unicode_test.html");
  const fileUrl = `file://${htmlPath}`;
  
  console.log(`Test HTML file: ${htmlPath}`);
  console.log(`File URL: ${fileUrl}`);
  
  // Test with filtering enabled (default)
  console.log("\n=== Test with filtering enabled (default) ===");
  console.log("Initializing Stagehand with filtering...");
  const mockLLMClient = new MockLLMClient();
  const stagehandWithFiltering = new Stagehand({
    env: "LOCAL",
    headless: false,
    verbose: 2,
    llmClient: mockLLMClient,
    characterFilterConfig: {
      blockLanguageTag: true,
      blockEmojiVariationBase: true,
      blockEmojiVariationModifier: true
    }
  });
  
  try {
    await stagehandWithFiltering.init();
    
    console.log("Navigating to test page...");
    await stagehandWithFiltering.page.goto(fileUrl);
    console.log("Navigated to test page");
    
    console.log("Extracting content with filtering...");
    const resultWithFiltering = await stagehandWithFiltering.page.extract({
      instruction: "Extract the text content from each section of the page. For each section, provide the title and an array of text content from paragraphs.",
      schema: TestPageSchema,
    });
    
    console.log("Extraction result with filtering:");
    console.log(JSON.stringify(resultWithFiltering, null, 2));
    
    // Analyze the results for code points
    console.log("\nAnalyzing results with filtering:");
    try {
      // Parse the content from the response
      const parsedResult = typeof resultWithFiltering === 'string' 
        ? JSON.parse(resultWithFiltering) 
        : resultWithFiltering;
        
      // Handle different response structures
      const sections = parsedResult.sections || 
                      (parsedResult.choices && 
                       parsedResult.choices[0]?.message?.content && 
                       JSON.parse(parsedResult.choices[0].message.content).sections);
      
      if (sections) {
        sections.forEach((section: { title: string; content: string[] }) => {
          console.log(`Section: ${section.title}`);
          section.content.forEach((text: string, i: number) => {
            console.log(`  Content ${i+1}: "${text}"`);
            console.log(`  Code points: ${printCodePoints(text)}`);
          });
        });
      } else {
        console.log("No sections found in the response");
        console.log("Response structure:", JSON.stringify(parsedResult, null, 2));
      }
    } catch (error) {
      console.error("Error parsing or analyzing results:", error);
      console.log("Raw result:", resultWithFiltering);
    }
    
    console.log("Closing browser...");
    await stagehandWithFiltering.close();
    console.log("Browser closed");
  } catch (error) {
    console.error("Error in test with filtering:", error);
    try {
      await stagehandWithFiltering.close();
    } catch (e) {
      console.error("Error closing browser:", e);
    }
  }
  
  // Test with filtering disabled
  console.log("\n=== Test with filtering disabled ===");
  console.log("Initializing Stagehand without filtering...");
  const stagehandWithoutFiltering = new Stagehand({
    env: "LOCAL",
    headless: false,
    verbose: 2,
    llmClient: mockLLMClient,
    characterFilterConfig: {
      blockLanguageTag: false,
      blockEmojiVariationBase: false,
      blockEmojiVariationModifier: false
    }
  });
  
  try {
    await stagehandWithoutFiltering.init();
    
    console.log("Navigating to test page...");
    await stagehandWithoutFiltering.page.goto(fileUrl);
    console.log("Navigated to test page");
    
    console.log("Extracting content without filtering...");
    const resultNoFiltering = await stagehandWithoutFiltering.page.extract({
      instruction: "Extract the text content from each section of the page. For each section, provide the title and an array of text content from paragraphs.",
      schema: TestPageSchema,
    });
    
    console.log("Extraction result without filtering:");
    console.log(JSON.stringify(resultNoFiltering, null, 2));
    
    // Analyze the results for code points
    console.log("\nAnalyzing results without filtering:");
    try {
      // Parse the content from the response
      const parsedResult = typeof resultNoFiltering === 'string' 
        ? JSON.parse(resultNoFiltering) 
        : resultNoFiltering;
        
      // Handle different response structures
      const sections = parsedResult.sections || 
                      (parsedResult.choices && 
                       parsedResult.choices[0]?.message?.content && 
                       JSON.parse(parsedResult.choices[0].message.content).sections);
      
      if (sections) {
        sections.forEach((section: { title: string; content: string[] }) => {
          console.log(`Section: ${section.title}`);
          section.content.forEach((text: string, i: number) => {
            console.log(`  Content ${i+1}: "${text}"`);
            console.log(`  Code points: ${printCodePoints(text)}`);
          });
        });
      } else {
        console.log("No sections found in the response");
        console.log("Response structure:", JSON.stringify(parsedResult, null, 2));
      }
    } catch (error) {
      console.error("Error parsing or analyzing results:", error);
      console.log("Raw result:", resultNoFiltering);
    }
    
    console.log("Closing browser...");
    await stagehandWithoutFiltering.close();
    console.log("Browser closed");
  } catch (error) {
    console.error("Error in test without filtering:", error);
    try {
      await stagehandWithoutFiltering.close();
    } catch (e) {
      console.error("Error closing browser:", e);
    }
  }
  
  console.log("\nTest completed!");
}

// Check if the HTML file exists, if not create it
const htmlPath = path.join(process.cwd(), "examples", "unicode_test.html");
if (!fs.existsSync(htmlPath)) {
  console.log("Unicode test HTML file not found, creating it...");
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unicode Character Test</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        .test-section {
            margin-bottom: 30px;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
        h2 {
            margin-top: 0;
        }
        .invisible {
            background-color: #f8f8f8;
            padding: 10px;
            border-left: 3px solid #ff6b6b;
        }
        .normal {
            background-color: #f8f8f8;
            padding: 10px;
            border-left: 3px solid #51cf66;
        }
        pre {
            background-color: #f1f1f1;
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <h1>Unicode Character Test Page</h1>
    
    <div class="test-section">
        <h2>Language Tag Characters (U+E0001, U+E0020-U+E007F)</h2>
        <div class="invisible">
            <p>This text contains language tag characters: Hello\\u{E0001} World\\u{E0020}\\u{E0021}\\u{E0022}</p>
            <p>These characters are invisible but can be used for prompt injection.</p>
        </div>
        <div class="normal">
            <p>This is normal text without language tag characters: Hello World</p>
        </div>
    </div>
    
    <div class="test-section">
        <h2>Emoji Variation Selectors (U+FE00-U+FE0F)</h2>
        <div class="invisible">
            <p>Text with emoji variation selectors: A\\uFE00 B\\uFE01 C\\uFE0F</p>
            <p>Emoji with variation selector: ☺\\uFE0F (smiling face with presentation selector)</p>
        </div>
        <div class="normal">
            <p>Normal text without variation selectors: A B C</p>
            <p>Normal emoji: ☺</p>
        </div>
    </div>
    
    <div class="test-section">
        <h2>Supplementary Variation Selectors (U+E0100-U+E01EF)</h2>
        <div class="invisible">
            <p>Text with supplementary variation selectors: X\\u{E0100} Y\\u{E0120} Z\\u{E0140}</p>
        </div>
        <div class="normal">
            <p>Normal text without supplementary variation selectors: X Y Z</p>
        </div>
    </div>
</body>
</html>`;

  // Replace escaped Unicode with actual Unicode
  const processedHtml = htmlContent
    .replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  fs.writeFileSync(htmlPath, processedHtml);
  console.log("Created Unicode test HTML file");
}

// Run the test
runTest().catch(error => {
  console.error("Unhandled error in test:", error);
  process.exit(1);
}); 