import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type * as activities from "./research-activities";

export async function searchWithRetry(query: string): Promise<string> {
  // Get workflow info for logging
  const info = workflowInfo();

  // Quick retry for initialization - might fail due to network
  const { initializeBrowser } = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "2 seconds",
      maximumInterval: "10 seconds",
      backoffCoefficient: 1.5,
      maximumAttempts: 5,
      nonRetryableErrorTypes: [],
    },
    startToCloseTimeout: "1 minute",
  });

  // Quick retry for navigation - usually fast
  const { navigateToSearchPage } = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "1 second",
      maximumInterval: "5 seconds",
      backoffCoefficient: 1.5,
      maximumAttempts: 8,
      nonRetryableErrorTypes: [],
    },
    startToCloseTimeout: "30 seconds",
  });

  // Standard retry for search execution
  const { executeSearch } = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "2 seconds",
      maximumInterval: "15 seconds",
      backoffCoefficient: 1.8,
      maximumAttempts: 10,
      nonRetryableErrorTypes: [],
    },
    startToCloseTimeout: "1 minute",
  });

  // More aggressive retry for extraction - most likely to fail
  const { extractSearchResults } = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "3 seconds",
      maximumInterval: "20 seconds",
      backoffCoefficient: 2,
      maximumAttempts: 10,
      nonRetryableErrorTypes: [],
    },
    startToCloseTimeout: "2 minutes",
  });

  // Cleanup should always succeed quickly
  const { cleanupBrowser } = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "1 second",
      maximumInterval: "3 seconds",
      backoffCoefficient: 1.2,
      maximumAttempts: 3,
      nonRetryableErrorTypes: [],
    },
    startToCloseTimeout: "10 seconds",
  });

  // Formatting is deterministic - minimal retry
  const { formatResults } = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "1 second",
      maximumInterval: "2 seconds",
      backoffCoefficient: 1,
      maximumAttempts: 2,
      nonRetryableErrorTypes: [],
    },
    startToCloseTimeout: "5 seconds",
  });

  console.log(`Starting resilient search workflow for: "${query}"`);
  console.log(`Workflow ID: ${info.workflowId}`);
  console.log(`\nUsing atomic activities with tailored retry policies:`);
  console.log(`- Initialize browser: up to 5 attempts`);
  console.log(`- Navigate to page: up to 8 attempts (fast retries)`);
  console.log(`- Execute search: up to 10 attempts`);
  console.log(`- Extract results: up to 10 attempts (most likely to fail)`);
  console.log(`- Cleanup: up to 3 attempts\n`);

  let browserSession;
  let searchResults;

  try {
    // Step 1: Initialize browser
    console.log("Step 1: Initializing browser session...");
    browserSession = await initializeBrowser();

    // Step 2: Navigate to search page
    console.log("Step 2: Navigating to search page...");
    await navigateToSearchPage(browserSession);

    // Step 3: Execute search
    console.log(`Step 3: Executing search for "${query}"...`);
    await executeSearch(browserSession, query);

    // Step 4: Extract results
    console.log("Step 4: Extracting search results...");
    searchResults = await extractSearchResults(browserSession);

    // Step 5: Format results
    console.log("Step 5: Formatting results...");
    const formatted = await formatResults(searchResults);

    console.log("Workflow completed successfully!");
    return formatted;
  } catch (error: any) {
    console.error(`Workflow failed:`, error.message);
    throw error;
  } finally {
    // Always try to cleanup the browser session
    if (browserSession) {
      try {
        console.log("Cleaning up browser session...");
        await cleanupBrowser(browserSession);
      } catch (cleanupError) {
        console.warn("Failed to cleanup browser session:", cleanupError);
        // Don't rethrow - cleanup failure shouldn't fail the workflow
      }
    }
  }
}
