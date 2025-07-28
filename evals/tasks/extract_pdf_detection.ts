import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const extract_pdf_detection: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  const results: Record<string, boolean> = {};

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
      await stagehand.page.extract({
        instruction:
          "Extract the title from https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        schema: z.object({
          title: z.string(),
        }),
      });
      results.pdfUrlInInstruction = true;
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
      await stagehand.page.extract({
        pdfUrl:
          "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        schema: z.object({
          content: z.string(),
        }),
      });
      results.pdfUrlParameter = true;
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

    // Test 3: Local PDF filepath detection in instruction
    logger.log({
      category: "pdf_extraction",
      message: "Testing PDF filepath detection in instruction",
      level: 1,
    });

    try {
      await stagehand.page.extract({
        instruction: "Extract data from report.pdf",
        schema: z.object({
          data: z.string(),
        }),
      });
      results.pdfFilepathInInstruction = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Reducto API key is required")) {
        results.pdfFilepathInInstruction = true; // Detection worked
        logger.log({
          category: "pdf_extraction",
          message: "PDF filepath detection successful",
          level: 1,
        });
      } else {
        results.pdfFilepathInInstruction = false;
        logger.log({
          category: "pdf_extraction",
          message: `Unexpected error: ${errorMessage}`,
          level: 1,
        });
      }
    }

    // Test 4: Direct PDF filepath parameter
    logger.log({
      category: "pdf_extraction",
      message: "Testing direct PDF filepath parameter",
      level: 1,
    });

    try {
      await stagehand.page.extract({
        pdfFilepath: "test-document.pdf",
        schema: z.object({
          summary: z.string(),
        }),
      });
      results.pdfFilepathParameter = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Reducto API key is required")) {
        results.pdfFilepathParameter = true; // Detection worked
        logger.log({
          category: "pdf_extraction",
          message: "PDF filepath parameter detection successful",
          level: 1,
        });
      } else {
        results.pdfFilepathParameter = false;
        logger.log({
          category: "pdf_extraction",
          message: `Unexpected error: ${errorMessage}`,
          level: 1,
        });
      }
    }

    // Test 5: Regular extraction should still work (not trigger PDF extraction)
    logger.log({
      category: "pdf_extraction",
      message: "Testing regular extraction still works",
      level: 1,
    });

    try {
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

    // Test 6: If Reducto API key is provided, test actual extraction
    if (stagehand.reductoApiKey) {
      logger.log({
        category: "pdf_extraction",
        message: "Reducto API key detected, testing actual PDF extraction",
        level: 1,
      });

      try {
        const pdfResult = await stagehand.page.extract({
          pdfUrl:
            "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
          schema: z.object({
            content: z.string().describe("The text content of the PDF"),
          }),
        });
        results.actualPdfExtraction = !!pdfResult.content;
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
      results.pdfFilepathInInstruction &&
      results.pdfFilepathParameter &&
      results.regularExtraction;

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
