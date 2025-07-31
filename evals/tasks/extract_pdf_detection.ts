import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const extract_pdf_detection: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  const results: Record<string, boolean> = {};
  const context = stagehand.context;
  const page = context.pages()[0];
  const client = await context.newCDPSession(page);

  await client.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: "downloads",
    eventsEnabled: true,
  });

  try {
    // Navigate to a simple page
    await stagehand.page.goto("https://example.com");

    // Test 1: PDF URL detection in instruction
    logger.log({
      category: "pdf_extraction",
      message: "Testing PDF URL detection in instruction",
      level: 1,
    });

    try {
      const result = await stagehand.page.extract({
        instruction:
          "Extract the title from https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        schema: z.object({
          title: z.string(),
        }),
      });
      results.pdfUrlInInstruction =
        result.title?.toLowerCase().includes("dummy") || false;
      logger.log({
        category: "pdf_extraction",
        message: `PDF URL extraction result: ${result.title}`,
        level: 1,
      });
    } catch (error) {
      // Check if it failed for the expected reason (no API key)
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Reducto API key is required")) {
        results.pdfUrlInInstruction = true; // Detection worked
        logger.log({
          category: "pdf_extraction",
          message:
            "PDF URL detection successful - extraction requires Reducto API key",
          level: 1,
        });
      } else {
        results.pdfUrlInInstruction = false;
        logger.log({
          category: "pdf_extraction",
          message: `Unexpected error: ${errorMessage}`,
          level: 1,
        });
      }
    }

    // Test 2: Direct PDF URL parameter
    logger.log({
      category: "pdf_extraction",
      message: "Testing direct PDF URL parameter",
      level: 1,
    });

    try {
      const result = await stagehand.page.extract({
        instruction: "Extract the title from the given PDF url",
        pdfUrl:
          "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        schema: z.object({
          content: z.string(),
        }),
      });
      results.pdfUrlParameter =
        result.content?.toLowerCase().includes("dummy") || false;
      logger.log({
        category: "pdf_extraction",
        message: `PDF URL parameter result: ${result.content}`,
        level: 1,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Reducto API key is required")) {
        results.pdfUrlParameter = true; // Detection worked
        logger.log({
          category: "pdf_extraction",
          message: "PDF URL parameter detection successful",
          level: 1,
        });
      } else {
        results.pdfUrlParameter = false;
        logger.log({
          category: "pdf_extraction",
          message: `Unexpected error: ${errorMessage}`,
          level: 1,
        });
      }
    }

    // Test 3: Regular extraction should still work (not trigger PDF extraction)
    logger.log({
      category: "pdf_extraction",
      message: "Testing regular extraction still works",
      level: 1,
    });

    try {
      await stagehand.page.goto("https://example.com");
      const result = await stagehand.page.extract({
        instruction: "Extract the main heading from the page",
        schema: z.object({
          heading: z.string(),
        }),
      });
      results.regularExtraction = result.heading?.includes("Example") || false;
      logger.log({
        category: "pdf_extraction",
        message: `Regular extraction result: ${JSON.stringify(result)}`,
        level: 1,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      results.regularExtraction = false;
      logger.log({
        category: "pdf_extraction",
        message: `Regular extraction failed: ${errorMessage}`,
        level: 1,
      });
    }

    // Test 4: If Reducto API key is provided, test actual extraction
    if (stagehand.reductoApiKey) {
      logger.log({
        category: "pdf_extraction",
        message: "Reducto API key detected, testing actual PDF extraction",
        level: 1,
      });

      try {
        const pdfResult = await stagehand.page.extract({
          instruction: "Extract the text from the given PDF url",
          pdfUrl:
            "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
          schema: z.object({
            content: z.string().describe("The text content of the PDF"),
          }),
        });
        results.actualPdfExtraction =
          pdfResult.content?.toLowerCase().includes("dummy") || false;
        logger.log({
          category: "pdf_extraction",
          message: `Actual PDF extraction successful: ${pdfResult.content?.substring(0, 100)}...`,
          level: 1,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.actualPdfExtraction = false;
        logger.log({
          category: "pdf_extraction",
          message: `Actual PDF extraction failed: ${errorMessage}`,
          level: 1,
        });
      }
    }

    // Check overall success
    const allDetectionsPassed =
      results.pdfUrlInInstruction &&
      results.pdfUrlParameter &&
      results.regularExtraction &&
      (results.actualPdfExtraction !== undefined
        ? results.actualPdfExtraction
        : true);

    logger.log({
      category: "pdf_extraction",
      message: `Test results: ${JSON.stringify(results, null, 2)}`,
      level: 1,
    });

    return {
      _success: allDetectionsPassed,
      results,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.log({
      category: "pdf_extraction",
      message: `Eval failed with error: ${error}`,
      level: 1,
    });

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
