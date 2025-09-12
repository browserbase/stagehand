import { EvalFunction } from "@/types/evals";

/**
 * Test the useCDP flag for screenshot functionality in Browserbase environments.
 * This test verifies that:
 * 1. Screenshots work with CDP (useCDP: true)
 * 2. Screenshots work with Playwright fallback (useCDP: false)
 * 3. Options are properly passed through in both modes
 */
export const screenshot_cdp_toggle: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    // Navigate to a test page
    await stagehand.page.goto("https://example.com");

    logger.log({
      message: "Testing screenshot with CDP enabled",
      level: 1,
    });

    // Test 1: Screenshot with CDP
    const cdpScreenshot = await stagehand.page.screenshot({
      fullPage: true,
      useCDP: true,
    });

    if (!cdpScreenshot || cdpScreenshot.length === 0) {
      logger.error({
        message: "CDP screenshot failed",
        level: 0,
        auxiliary: {
          size: {
            value: cdpScreenshot ? cdpScreenshot.length.toString() : "null",
            type: "string",
          },
        },
      });
      return {
        _success: false,
        error: "CDP screenshot produced empty result",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    logger.log({
      message: `CDP screenshot successful: ${cdpScreenshot.length} bytes`,
      level: 1,
    });

    logger.log({
      message: "Testing screenshot with Playwright (CDP disabled)",
      level: 1,
    });

    // Test 2: Screenshot with Playwright
    const playwrightScreenshot = await stagehand.page.screenshot({
      fullPage: true,
      useCDP: false,
    });

    if (!playwrightScreenshot || playwrightScreenshot.length === 0) {
      logger.error({
        message: "Playwright screenshot failed",
        level: 0,
        auxiliary: {
          size: {
            value: playwrightScreenshot
              ? playwrightScreenshot.length.toString()
              : "null",
            type: "string",
          },
        },
      });
      return {
        _success: false,
        error: "Playwright screenshot produced empty result",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    logger.log({
      message: `Playwright screenshot successful: ${playwrightScreenshot.length} bytes`,
      level: 1,
    });

    // Test 3: Test with additional options (JPEG format)
    logger.log({
      message: "Testing screenshot with JPEG format and quality settings",
      level: 1,
    });

    const jpegScreenshot = await stagehand.page.screenshot({
      type: "jpeg",
      quality: 80,
      useCDP: false,
    });

    if (!jpegScreenshot || jpegScreenshot.length === 0) {
      logger.error({
        message: "JPEG screenshot failed",
        level: 0,
      });
      return {
        _success: false,
        error: "JPEG screenshot produced empty result",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    logger.log({
      message: `JPEG screenshot successful: ${jpegScreenshot.length} bytes`,
      level: 1,
    });

    // Test 4: Test with clip option
    logger.log({
      message: "Testing screenshot with clip region",
      level: 1,
    });

    const clippedScreenshot = await stagehand.page.screenshot({
      clip: { x: 0, y: 0, width: 500, height: 300 },
      useCDP: true,
    });

    if (!clippedScreenshot || clippedScreenshot.length === 0) {
      logger.error({
        message: "Clipped screenshot failed",
        level: 0,
      });
      return {
        _success: false,
        error: "Clipped screenshot produced empty result",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    // Verify clipped screenshot is smaller than full page
    if (clippedScreenshot.length >= cdpScreenshot.length) {
      logger.error({
        message: "Clipped screenshot is not smaller than full screenshot",
        level: 0,
        auxiliary: {
          clipped_size: {
            value: clippedScreenshot.length.toString(),
            type: "integer",
          },
          full_size: {
            value: cdpScreenshot.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Clipped screenshot size validation failed",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    logger.log({
      message: `Clipped screenshot successful: ${clippedScreenshot.length} bytes`,
      level: 1,
    });

    logger.log({
      message: "All screenshot tests passed successfully",
      level: 0,
      auxiliary: {
        cdp_size: {
          value: cdpScreenshot.length.toString(),
          type: "integer",
        },
        playwright_size: {
          value: playwrightScreenshot.length.toString(),
          type: "integer",
        },
        jpeg_size: {
          value: jpegScreenshot.length.toString(),
          type: "integer",
        },
        clipped_size: {
          value: clippedScreenshot.length.toString(),
          type: "integer",
        },
      },
    });

    return {
      _success: true,
      cdpSize: cdpScreenshot.length,
      playwrightSize: playwrightScreenshot.length,
      jpegSize: jpegScreenshot.length,
      clippedSize: clippedScreenshot.length,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "Screenshot CDP toggle test failed",
      level: 0,
      auxiliary: {
        error: {
          value: error.message || String(error),
          type: "string",
        },
        stack: {
          value: error.stack || "",
          type: "string",
        },
      },
    });

    return {
      _success: false,
      error: error.message || String(error),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
