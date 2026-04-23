import { Stagehand } from "../lib/v3/index.js";
// import { Protocol } from "devtools-protocol";
import fs from "fs";
import { performUnderstudyMethod } from "@/packages/core/lib/v3/handlers/handlerUtils/actHandlerUtils";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */
  const page = stagehand.context.pages()[0];

  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/nested-dropdown/",
  );

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const html = await page
    .locator("xpath=//*[@id='licenseType']")
    .selectOption("Smog Check Technician");
  console.log(html);

  // await performUnderstudyMethod(
  //   page,
  //   page.mainFrame(),
  //   "selectOptionFromDropdown",
  //   "xpath=//*[@id='licenseType']",
  //   ["Smog Check Technician"],
  //   30000,
  // );
  // await page.goto(
  //   "https://etsy.com",
  // );
  //
  //
  // await new Promise(resolve => setTimeout(resolve, 3000));
  // await stagehand.act("click on 'categories'")
  //
  // await new Promise(resolve => setTimeout(resolve, 3000));
  // await stagehand.act("click on 'bath & beauty'")

  // use performsearch with the xpath: /html/some/xpath/here

  // await page.goto(
  //   "https://browserbase.github.io/stagehand-eval-sites/sites/shadow-dom-closed/",
  // );
  //
  //
  // await new Promise(resolve => setTimeout(resolve, 3000));
  //
  //
  // await page.locator("div > button").click();
  // await page.sendCDP("DOM.enable");
  // const res = await page.sendCDP("DOM.getDocument", {
  //   depth: -1,
  //   pierce: true,
  // });
  //
  // fs.writeFileSync("dom.json", JSON.stringify(res, null, 2));

  // const xpath = `/html/body`;
  //
  // // await page.locator("div > button").click();
  //
  //
  // // perform search with xpath
  // const search = await page.sendCDP<Protocol.DOM.PerformSearchResponse>(
  //   "DOM.performSearch",
  //   {
  //     query: xpath,
  //     includeUserAgentShadowDOM: true,
  //   },
  // );
  //
  // console.log(search);
  // console.log("performSearch:", {
  //   xpath,
  //   resultCount: search.resultCount,
  //   searchId: search.searchId,
  // });
  //
  // const maxResults = Math.min(search.resultCount, 5);
  // if (maxResults === 0) {
  //   await page.sendCDP("DOM.discardSearchResults", { searchId: search.searchId });
  //   console.log("No matches found.");
  //   return;
  // }
  //
  // // get search result here
  // const searchResults = await page.sendCDP<Protocol.DOM.GetSearchResultsResponse>(
  //   "DOM.getSearchResults",
  //   {
  //     searchId: search.searchId,
  //     fromIndex: 0,
  //     toIndex: 1,
  //   },
  // );
  //
  // console.log("searchresults: ", searchResults);
  //
  // const firstNodeId = searchResults.nodeIds[0];
  // console.log("nodeIds:", searchResults.nodeIds);
  //
  // if (firstNodeId) {
  //   const nodeDetails = await page.sendCDP<Protocol.DOM.DescribeNodeResponse>(
  //     "DOM.describeNode",
  //     { nodeId: firstNodeId },
  //   );
  //   console.log("firstMatch:", {
  //     nodeId: firstNodeId,
  //     nodeName: nodeDetails.node.nodeName,
  //     localName: nodeDetails.node.localName,
  //     backendNodeId: nodeDetails.node.backendNodeId,
  //   });
  // }
  //
  // await page.sendCDP("DOM.discardSearchResults", { searchId: search.searchId });

  // await new Promise(resolve => setTimeout(resolve, 3000));
  // await page.goto("https://jsconsole.com/")
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    // disableAPI: true,
    // browserbaseSessionCreateParams: {
    //   browserSettings: {
    //     advancedStealth: true,
    //     solveCaptchas: false,
    //   },
    //   proxies: true,
    // },
    // model: "openai/gpt-5",
    verbose: 2,
  });
  await stagehand.init();
  await example(stagehand);
})();
