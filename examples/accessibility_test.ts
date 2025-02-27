// import { Stagehand } from "../lib";
// // import { z } from "zod";
// import dotenv from "dotenv";
// // import { Page, ElementHandle } from "@playwright/test";
// import { Page } from "@playwright/test";
// import fs from "fs";
// // import { resolve } from "path";
// // import chalk from "chalk";
// import { CDPSession } from "@playwright/test";

// dotenv.config();

// type AccessibilityNode = {
//   role: string;
//   name?: string;
//   description?: string;
//   value?: string;
//   children?: AccessibilityNode[];
//   nodeId?: string;
// };

// interface TreeResult {
//   tree: AccessibilityNode[];
//   simplified: string;
// }

// function formatSimplifiedTree(node: AccessibilityNode, level = 0): string {
//   const indent = "  ".repeat(level);
//   let result = `${indent}[${node.nodeId}] ${node.role}${node.name ? `: ${node.name}` : ""}\n`;

//   if (node.children?.length) {
//     result += node.children
//       .map((child) => formatSimplifiedTree(child, level + 1))
//       .join("");
//   }
//   return result;
// }

// /**
//  * Builds a hierarchical tree structure from flat accessibility nodes while cleaning up structural nodes.
//  * @param nodes - Array of raw accessibility nodes from the browser
//  * @returns Object containing both the processed tree and a simplified text representation
//  */
// function buildHierarchicalTree(nodes: any[]): TreeResult {
//   // Map to store processed nodes for quick lookup and reference
//   const nodeMap = new Map<string, AccessibilityNode>();

//   // First pass: Create valid nodes and filter out unnecessary ones
//   nodes.forEach((node) => {
//     const hasChildren = node.childIds && node.childIds.length > 0;
//     const hasValidName = node.name && node.name.trim() !== "";
//     const isInteractive =
//       node.role !== "none" &&
//       node.role !== "generic" &&
//       node.role !== "InlineTextBox"; //add other interactive roles here

//     // Include nodes that are either named, have children, or are interactive
//     if (!hasValidName && !hasChildren && !isInteractive) {
//       return;
//     }

//     // Create a clean node object with only necessary properties
//     nodeMap.set(node.nodeId, {
//       role: node.role,
//       nodeId: node.nodeId,
//       // Only include optional properties if they exist and have value
//       ...(hasValidName && { name: node.name }),
//       ...(node.description && { description: node.description }),
//       ...(node.value && { value: node.value }),
//     });
//   });

//   // Second pass: Establish parent-child relationships in the tree
//   nodes.forEach((node) => {
//     if (node.parentId && nodeMap.has(node.nodeId)) {
//       const parentNode = nodeMap.get(node.parentId);
//       const currentNode = nodeMap.get(node.nodeId);

//       if (parentNode && currentNode) {
//         // Initialize children array if it doesn't exist
//         if (!parentNode.children) {
//           parentNode.children = [];
//         }
//         parentNode.children.push(currentNode);
//       }
//     }
//   });

//   // Get root nodes (nodes without parents) to start building the tree
//   const initialTree = nodes
//     .filter((node) => !node.parentId && nodeMap.has(node.nodeId))
//     .map((node) => nodeMap.get(node.nodeId))
//     .filter(Boolean) as AccessibilityNode[];

//   // Save full tree for debugging purposes
//   fs.writeFileSync(
//     "../full_tree.json",
//     JSON.stringify(initialTree, null, 2),
//     "utf-8",
//   );

//   /**
//    * Recursively cleans up structural nodes ('generic' and 'none') by either:
//    * 1. Removing them if they have no children
//    * 2. Replacing them with their single child if they have exactly one child
//    * 3. Keeping them but cleaning their children if they have multiple children
//    */
//   function cleanStructuralNodes(
//     node: AccessibilityNode,
//   ): AccessibilityNode | null {
//     // Filter out nodes with negative IDs
//     if (node.nodeId && parseInt(node.nodeId) < 0) {
//       return null;
//     }

//     // Base case: leaf node
//     if (!node.children) {
//       return node.role === "generic" || node.role === "none" ? null : node;
//     }

//     // Recursively clean children
//     const cleanedChildren = node.children
//       .map((child) => cleanStructuralNodes(child))
//       .filter(Boolean) as AccessibilityNode[];

//     // Handle structural nodes (generic/none)
//     if (node.role === "generic" || node.role === "none") {
//       if (cleanedChildren.length === 1) {
//         // Replace structural node with its single child
//         return cleanedChildren[0];
//       } else if (cleanedChildren.length > 1) {
//         // Keep structural node but with cleaned children
//         return { ...node, children: cleanedChildren };
//       }
//       // Remove structural node with no children
//       return null;
//     }

//     // For non-structural nodes, keep them with their cleaned children
//     return cleanedChildren.length > 0
//       ? { ...node, children: cleanedChildren }
//       : node;
//   }

//   // Process the final tree by cleaning structural nodes
//   const finalTree = nodes
//     .filter((node) => !node.parentId && nodeMap.has(node.nodeId))
//     .map((node) => nodeMap.get(node.nodeId))
//     .filter(Boolean)
//     .map((node) => cleanStructuralNodes(node))
//     .filter(Boolean) as AccessibilityNode[];

//   // Create a human-readable text representation of the tree
//   const simplifiedFormat = finalTree
//     .map((node) => formatSimplifiedTree(node))
//     .join("\n");

//   // Save simplified tree for debugging
//   fs.writeFileSync("../pruned_tree.txt", simplifiedFormat, "utf-8");

//   return {
//     tree: finalTree,
//     simplified: simplifiedFormat,
//   };
// }

// async function axSnapshot(page: Page) {
//   const cdpClient = await page.context().newCDPSession(page);
//   await cdpClient.send("Accessibility.enable");
//   const { nodes } = await cdpClient.send("Accessibility.getFullAXTree");
//   fs.writeFileSync(
//     "../ax_snapshot.json",
//     JSON.stringify(nodes, null, 2),
//     "utf-8",
//   );
//   return nodes;
// }

// async function getAccessibilityTree(page: Page) {
//   const cdpClient = await page.context().newCDPSession(page);
//   await cdpClient.send("Accessibility.enable");

//   try {
//     // await new Promise((resolve) => setTimeout(resolve, 2000));
//     // const frames = await cdpClient.send("Page.getFrameTree");
//     // console.log(frames);

//     const { nodes } = await cdpClient.send("Accessibility.getFullAXTree");
//     // const { nodes } = await cdpClient.send("Accessibility.getFullAXTree", {
//     //   frameId: frames.frameTree.frame.id,
//     //   depth: 10,
//     // });
//     // Extract specific sources
//     const sources = nodes.map((node) => ({
//       role: node.role?.value,
//       name: node.name?.value,
//       description: node.description?.value,
//       chromeRole: node.chromeRole?.value,
//       properties: node.properties,
//       value: node.value?.value,
//       nodeId: node.nodeId,
//       parentId: node.parentId,
//       childIds: node.childIds,
//       // backendDOMNodeId: node.backendDOMNodeId,
//     }));

//     fs.writeFileSync(
//       "../sources.json",
//       JSON.stringify(sources, null, 2),
//       "utf-8",
//     );
//     // Transform into hierarchical structure
//     const hierarchicalTree = buildHierarchicalTree(sources);

//     // Save the hierarchical accessibility tree to a JSON file
//     // fs.writeFileSync(
//     //   "../pruned_tree.json",
//     //   JSON.stringify(hierarchicalTree, null, 2),
//     //   "utf-8",
//     // );

//     return hierarchicalTree.simplified;
//   } finally {
//     await cdpClient.send("Accessibility.disable");
//   }
// }

// async function getAccessibilityTreeV2(
//   page: Page,
//   currentViewportOnly: boolean = false,
// ) {
//   const cdpClient = await page.context().newCDPSession(page);
//   await cdpClient.send("Accessibility.enable");

//   try {
//     // Get browser viewport info
//     const viewportSize = page.viewportSize();
//     if (!viewportSize) {
//       throw new Error("Viewport size not available");
//     }

//     const browserInfo: BrowserInfo = {
//       config: {
//         viewport: {
//           width: viewportSize.width,
//           height: viewportSize.height,
//         },
//       },
//     };

//     // Fetch and process the accessibility tree
//     const accessibilityTree = await fetchPageAccessibilityTree(
//       browserInfo,
//       cdpClient,
//       currentViewportOnly,
//     );

//     // Parse the tree into a readable format
//     const [treeStr, obsNodesInfo] = parseAccessibilityTree(accessibilityTree);

//     // Clean up the tree
//     const cleanedTree = cleanAccessibilityTree(treeStr);

//     // Save debug files
//     fs.writeFileSync("../ax_tree_v2.txt", cleanedTree, "utf-8");
//     // fs.writeFileSync(
//     //   "../ax_nodes_v2.json",
//     //   JSON.stringify(obsNodesInfo, null, 2),
//     //   "utf-8"
//     // );

//     return cleanedTree;
//   } finally {
//     await cdpClient.send("Accessibility.disable");
//   }
// }

// interface BrowserInfo {
//   config: {
//     viewport: {
//       width: number;
//       height: number;
//     };
//   };
// }

// interface AXValue {
//   type?: string;
//   value?: string;
//   // Add other potential properties from AXValue type
// }

// interface AccessibilityTreeNode {
//   nodeId: string;
//   role?: AXValue;
//   name?: AXValue;
//   parentId?: string;
//   childIds?: string[];
//   backendDOMNodeId?: number;
//   union_bound?: [number, number, number, number] | null;
//   properties?: Array<{
//     name: string;
//     value: AXValue;
//   }>;
// }

// type AccessibilityTree = AccessibilityTreeNode[];

// const IGNORED_ACTREE_PROPERTIES: string[] = [
//   // Add properties to ignore here
//   "busy",
//   "live",
//   "relevant",
//   "atomic",
// ];

// const IN_VIEWPORT_RATIO_THRESHOLD = 0.1;

// async function fetchPageAccessibilityTree(
//   info: BrowserInfo,
//   client: CDPSession,
//   currentViewportOnly: boolean = false,
// ): Promise<AccessibilityTree> {
//   let accessibilityTree: AccessibilityTree = (
//     await client.send("Accessibility.getFullAXTree", {})
//   ).nodes;

//   // Remove duplicate nodes
//   const seenIds = new Set<string>();
//   accessibilityTree = accessibilityTree.filter((node) => {
//     if (!seenIds.has(node.nodeId)) {
//       seenIds.add(node.nodeId);
//       return true;
//     }
//     return false;
//   });

//   // Create node ID to cursor mapping
//   const nodeIdToCursor = new Map<string, number>();
//   for (let cursor = 0; cursor < accessibilityTree.length; cursor++) {
//     const node = accessibilityTree[cursor];
//     nodeIdToCursor.set(node.nodeId, cursor);

//     if (!node.backendDOMNodeId) {
//       node.union_bound = null;
//       continue;
//     }

//     const backendNodeId = String(node.backendDOMNodeId);
//     if (node.role.value === "RootWebArea") {
//       node.union_bound = [0.0, 0.0, 10.0, 10.0];
//     } else {
//       try {
//         const response = await getBoundingClientRect(client, backendNodeId);
//         if (response?.result?.subtype === "error") {
//           node.union_bound = null;
//         } else {
//           const { x, y, width, height } = response.result.value;
//           node.union_bound = [x, y, width, height];
//         }
//       } catch {
//         node.union_bound = null;
//       }
//     }
//   }

//   if (currentViewportOnly) {
//     const removeNodeInGraph = (node: AccessibilityTreeNode): void => {
//       const nodeId = node.nodeId;
//       const nodeCursor = nodeIdToCursor.get(nodeId)!;
//       const parentNodeId = node.parentId!;
//       const childrenNodeIds = node.childIds;
//       const parentCursor = nodeIdToCursor.get(parentNodeId)!;

//       // Update parent's children
//       const parentNode = accessibilityTree[parentCursor];
//       const index = parentNode.childIds.indexOf(nodeId);
//       parentNode.childIds.splice(index, 1);
//       parentNode.childIds.splice(index, 0, ...childrenNodeIds);

//       // Update children's parent
//       for (const childNodeId of childrenNodeIds) {
//         const childCursor = nodeIdToCursor.get(childNodeId)!;
//         accessibilityTree[childCursor].parentId = parentNodeId;
//       }

//       // Mark as removed
//       accessibilityTree[nodeCursor].parentId = "[REMOVED]";
//     };

//     const config = info.config;
//     for (const node of accessibilityTree) {
//       if (!node.union_bound) {
//         removeNodeInGraph(node);
//         continue;
//       }

//       const [x, y, width, height] = node.union_bound;

//       // Remove invisible nodes
//       if (width === 0 || height === 0) {
//         removeNodeInGraph(node);
//         continue;
//       }

//       const inViewportRatio = getElementInViewportRatio(
//         x,
//         y,
//         width,
//         height,
//         config,
//       );

//       if (inViewportRatio < IN_VIEWPORT_RATIO_THRESHOLD) {
//         removeNodeInGraph(node);
//       }
//     }

//     accessibilityTree = accessibilityTree.filter(
//       (node) => node.parentId !== "[REMOVED]",
//     );
//   }

//   return accessibilityTree;
// }

// function parseAccessibilityTree(
//   accessibilityTree: AccessibilityTree,
// ): [string, Record<string, any>] {
//   const nodeIdToIdx = new Map<string, number>();
//   for (let idx = 0; idx < accessibilityTree.length; idx++) {
//     nodeIdToIdx.set(accessibilityTree[idx].nodeId, idx);
//   }

//   const obsNodesInfo: Record<string, any> = {};

//   function dfs(idx: number, obsNodeId: string, depth: number): string {
//     let treeStr = "";
//     const node = accessibilityTree[idx];
//     const indent = "\t".repeat(depth);
//     let validNode = true;

//     try {
//       const role = node.role?.value;
//       const name = node.name?.value || "";
//       let nodeStr = `[${obsNodeId}] ${role} ${JSON.stringify(name)}`;

//       const properties: string[] = [];
//       for (const property of node.properties || []) {
//         try {
//           if (IGNORED_ACTREE_PROPERTIES.includes(property.name)) {
//             continue;
//           }
//           properties.push(`${property.name}: ${property.value.value}`);
//         } catch {
//           // Skip invalid properties
//         }
//       }

//       if (properties.length) {
//         nodeStr += " " + properties.join(" ");
//       }

//       // Validate node
//       if (!nodeStr.trim()) {
//         validNode = false;
//       }

//       // Check empty generic nodes
//       if (!name.trim()) {
//         if (!properties.length) {
//           if (
//             [
//               "generic",
//               "img",
//               "list",
//               "strong",
//               "paragraph",
//               "banner",
//               "navigation",
//               "Section",
//               "LabelText",
//               "Legend",
//               "listitem",
//             ].includes(role)
//           ) {
//             validNode = false;
//           }
//         } else if (role === "listitem") {
//           validNode = false;
//         }
//       }

//       if (validNode) {
//         treeStr += `${indent}${nodeStr}`;
//         obsNodesInfo[obsNodeId] = {
//           backend_id: node.backendDOMNodeId,
//           union_bound: node.union_bound,
//           text: nodeStr,
//         };
//       }
//     } catch {
//       validNode = false;
//     }

//     for (const childNodeId of node.childIds) {
//       if (!nodeIdToIdx.has(childNodeId)) {
//         continue;
//       }
//       const childDepth = validNode ? depth + 1 : depth;
//       const childStr = dfs(
//         nodeIdToIdx.get(childNodeId)!,
//         childNodeId,
//         childDepth,
//       );
//       if (childStr.trim()) {
//         if (treeStr.trim()) {
//           treeStr += "\n";
//         }
//         treeStr += childStr;
//       }
//     }

//     return treeStr;
//   }

//   const treeStr = dfs(0, accessibilityTree[0].nodeId, 0);
//   return [treeStr, obsNodesInfo];
// }

// function cleanAccessibilityTree(treeStr: string): string {
//   const cleanLines: string[] = [];
//   const lines = treeStr.split("\n");

//   for (const line of lines) {
//     if (line.toLowerCase().includes("statictext")) {
//       const prevLines = cleanLines.slice(-3);
//       const pattern = /\[\d+\] StaticText (.+)/;
//       const match = pattern.exec(line);

//       if (match) {
//         const staticText = match[1].slice(1, -1); // Remove quotes
//         if (
//           staticText &&
//           prevLines.every((prevLine) => !prevLine.includes(staticText))
//         ) {
//           cleanLines.push(line);
//         }
//       }
//     } else {
//       cleanLines.push(line);
//     }
//   }

//   return cleanLines.join("\n");
// }

// // Helper function to get element's viewport ratio
// function getElementInViewportRatio(
//   elemLeftBound: number,
//   elemTopBound: number,
//   width: number,
//   height: number,
//   config: { viewport: { width: number; height: number } },
// ): number {
//   const viewportWidth = config.viewport.width;
//   const viewportHeight = config.viewport.height;

//   const elemRightBound = elemLeftBound + width;
//   const elemBottomBound = elemTopBound + height;

//   const xOverlap = Math.max(
//     0,
//     Math.min(elemRightBound, viewportWidth) - Math.max(elemLeftBound, 0),
//   );
//   const yOverlap = Math.max(
//     0,
//     Math.min(elemBottomBound, viewportHeight) - Math.max(elemTopBound, 0),
//   );

//   const overlapArea = xOverlap * yOverlap;
//   const elemArea = width * height;

//   return elemArea > 0 ? overlapArea / elemArea : 0;
// }

// // Helper function to get bounding client rect
// async function getBoundingClientRect(
//   client: CDPSession,
//   backendNodeId: string,
// ) {
//   const script = `
//     function getBoundingClientRect(node) {
//       const rect = node.getBoundingClientRect();
//       return {
//         x: rect.x,
//         y: rect.y,
//         width: rect.width,
//         height: rect.height
//       };
//     }
//   `;

//   return await client.send("Runtime.callFunctionOn", {
//     functionDeclaration: script,
//     objectId: backendNodeId,
//   });
// }

// async function getIframe(page: Page, stagehand: Stagehand) {
//   await page.goto("https://tucowsdomains.com/abuse-form/phishing/");
//   await new Promise((resolve) => setTimeout(resolve, 3000));
//   const iframeSrc = await page.locator("iframe").first().getAttribute("src");
//   if (iframeSrc) {
//     console.log(`Navigating to iframe URL: ${iframeSrc}`);

//     // 2️⃣ Open the iframe content in a new Playwright page
//     const iframePage = await stagehand.page.context().newPage();
//     await iframePage.goto(iframeSrc);

//     // 3️⃣ Extract the full HTML of the iframe
//     const iframeContent = await iframePage.evaluate(
//       () => document.documentElement.outerHTML,
//     );
//     console.log("Retrieved Iframe DOM!");

//     // 4️⃣ Inject the iframe content back into the parent page
//     await page.evaluate((html) => {
//       const iframeContainer = document.querySelector("iframe");
//       if (iframeContainer) {
//         const div = document.createElement("div");
//         div.innerHTML = html;
//         iframeContainer.replaceWith(div);
//       }
//     }, iframeContent);
//     await getAccessibilityTree(page);
//     console.log("Iframe content merged into main page!");
//     await iframePage.close();
//   } else {
//     console.log("No iframe found.");
//   }
// }

// async function main() {
//   // Initialize stagehand with local environment
//   const stagehand = new Stagehand({
//     env: "LOCAL",
//     debugDom: false,
//     verbose: 1,
//     // modelName: "gpt-4o",
//     // modelName: "gpt-4o-mini",
//     modelName: "claude-3-7-sonnet-20250219",
//     enableCaching: false,
//   });

//   // Initialize the stagehand instance
//   await stagehand.init();
//   const page = stagehand.page;

//   await page.goto("https://google.com");
//   await getAccessibilityTree(page);
//   // await page.act("click 'Cómo comprar'");
//   // await page.observe("find the 'Cómo comprar' button/link at the bottom of the page")
//   const legales = await page.act(
//     "find and click all the 'ver legales' buttons on the page",
//   );
//   await page.observe("hit escape");
//   // await new Promise(resolve => setTimeout(resolve, 10000));
//   // await page.keyboard.press("Escape");
//   // const legales = await page.observe("find and click all the 'ver legales' buttons on the page");

//   // let extracted = [];
//   // for (const el of legales) {
//   //   if (el.method !== "not-supported") {
//   //     console.log("clicking", el);
//   //     await page.act(el);
//   //     await new Promise(resolve => setTimeout(resolve, 1000));
//   //     extracted.push(await page.extract({
//   //       instruction: "extract the text of the Legales section/dialog",
//   //       schema: z.object({
//   //         text: z.string(),
//   //       }),
//   //     }));
//   //     console.log("extracted", extracted);
//   //     await page.keyboard.press("Escape");
//   //   }
//   // }
//   // console.log("all extracted", extracted);
//   // await new Promise((resolve) => setTimeout(resolve, 60000));

//   // const mainPage = stagehand.page;
//   // await mainPage.goto("https://example.com");
//   // const response = await stagehand.llmClient.createChatCompletion({
//   //   options: {
//   //     requestId: Math.random().toString(36).substring(2),
//   //     messages: [
//   //       {
//   //         role: "user",
//   //         content: "What is the capital of France?",
//   //       },
//   //     ],
//   //   },
//   //   logger: () => {},
//   // });
//   // console.log(response.choices[0].message.content);

//   // // Create a new page with full Stagehand capabilities
//   // const context = await stagehand.context;
//   // const newPage = await context.newPage();
//   // await newPage.goto("https://google.com");
//   // const ob = await newPage.observe({
//   //   onlyVisible: true,
//   // });
//   // console.log(ob);

//   // const observeRes = await newPage.extract({
//   //   instruction: "extract the list of buttons on the page",
//   //   schema: z.object({
//   //     buttons: z.array(
//   //       z.object({
//   //         text: z.string(),
//   //       }),
//   //     ),
//   //   }),
//   //   useTextExtract: true,
//   // });
//   // console.log(observeRes);
//   // mainPage.bringToFront();
//   // const observeRe = await mainPage.extract({
//   //   instruction: "extract the main header on the page",
//   //   schema: z.object({
//   //     header: z.string(),
//   //   }),
//   //   useTextExtract: true,
//   // });
//   // console.log(observeRe);

//   // const observeRes2 = await newPage.observe({
//   //   instruction: "fill the search bar with 'hello world python'",
//   // });
//   // await newPage.act(observeRes2[0]);
//   // // const observeRes10 = await newPage.observe({
//   // //   instruction: "click the google search button",
//   // // });
//   // // await newPage.act(observeRes10[0]);
//   // // await newPage.waitForLoadState("networkidle");
//   // await newPage.keyboard.press("Enter");

//   // await new Promise((resolve) => setTimeout(resolve, 2000));

//   // const observeRes3 = await newPage.act({
//   //   action: "click the first link result on the page",
//   // });

//   // await new Promise((resolve) => setTimeout(resolve, 2000));

//   // console.log(
//   //   await newPage.extract({
//   //     instruction: "extract the first result of the page",
//   //     schema: z.object({
//   //       title: z.string(),
//   //     }),
//   //     useTextExtract: false,
//   //   }),
//   // );

//   // // All pages have act/observe/extract
//   // // await newPage.act('Click something');
//   // console.log(
//   //   await mainPage.extract({
//   //     instruction: "Get the heading",
//   //     schema: z.object({ heading: z.string() }),
//   //   }),
//   // );

//   // await stagehand.page.goto("https://www.zillow.com/san-francisco-ca/rentals/2_p/?searchQueryState=%7B%22pagination%22%3A%7B%22currentPage%22%3A2%7D%2C%22isMapVisible%22%3Atrue%2C%22mapBounds%22%3A%7B%22west%22%3A-122.63932315234375%2C%22east%22%3A-122.22733584765625%2C%22south%22%3A37.638803369210315%2C%22north%22%3A37.91152902354437%7D%2C%22mapZoom%22%3A12%2C%22usersSearchTerm%22%3A%22San%20Francisco%20CA%22%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A20330%2C%22regionType%22%3A6%7D%5D%2C%22filterState%22%3A%7B%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22cmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22beds%22%3A%7B%22min%22%3A1%2C%22max%22%3Anull%7D%7D%2C%22isListVisible%22%3Atrue%7D");
//   // await stagehand.page.goto("https://shopify.com");
//   // await new Promise(resolve => setTimeout(resolve, 5000));

//   // const cdpClient = await page.context().newCDPSession(page);
//   // await cdpClient.send("DOM.enable");
//   // const { root: documentNode } = await cdpClient.send("DOM.getDocument");

//   // await page.goto("https://file.1040.com/estimate/");
//   // await getIframe(page, stagehand);
//   // const observed = await stagehand.page.observe({
//   //   instruction:
//   //     "fill all the form fields (including buttons!) in the page with mock data",
//   //   // useAccessibilityTree: true,
//   //   returnAction: true,
//   // });
//   // console.log(observed);

//   // if (observed.length > 0) {
//   //   // Access the private actHandler instance
//   //   const actHandler = (stagehand as any).stagehandPage.actHandler;
//   //   for (const el of observed) {
//   //     // const el = observed[0];
//   //     await new Promise((resolve) => setTimeout(resolve, 500));
//   //     await actHandler._performPlaywrightMethod(
//   //       el.method, // method
//   //       // ["mockemail@example.com"],
//   //       el.arguments, // args (empty for click)
//   //       el.selector.replace("xpath=", ""), // Remove 'xpath=' prefix from selector
//   //     );
//   //   }
//   // }

//   /*
//     Playwright getByRole resolution when resolving to 1+ elements
//   */
//   // const locator = page.getByRole('link', { name: 'Perplexity' }).nth(1);
//   // const locator = page.getByRole('button', { name: 'Solutions' });
//   // const locator = page.getByRole('listitem').filter({hasText: 'the fastest way'}).getByRole('link', { name: 'Perplexity' });

//   // try {
//   //   await locator.click();
//   // } catch (error) {
//   //   if (error.message.includes('strict mode violation')) {
//   //     console.log(error.message.split('Call log:')[0].trim());
//   //   }
//   // }
//   // await stagehand.page.goto("https://shopify.com");
//   // await stagehand.page.goto("https://www.google.com/search?q=top+highest-grossing+animated+movies&sca_esv=aa5aa35c323c7bba&source=hp&ei=DjWHZ4OdOs-_0PEPvdjxoAs&iflsig=AL9hbdgAAAAAZ4dDHmuGexbLKUNu-hjx7TApQTwQVUVS&ved=0ahUKEwiD3O3K7faKAxXPHzQIHT1sHLQQ4dUDCBA&uact=5&oq=top+highest-grossing+animated+movies&gs_lp=Egdnd3Mtd2l6IiR0b3AgaGlnaGVzdC1ncm9zc2luZyBhbmltYXRlZCBtb3ZpZXMyBhAAGBYYHjIGEAAYFhgeMgYQABgWGB4yBhAAGBYYHjIGEAAYFhgeMgsQABiABBiGAxiKBTILEAAYgAQYhgMYigUyCxAAGIAEGIYDGIoFMgsQABiABBiGAxiKBTILEAAYgAQYhgMYigVI0AdQAFifAXAAeACQAQCYAesDoAHrDqoBAzQtNLgBA8gBAPgBAZgCBKAC8Q6YAwCSBwM0LTSgB_Ak&sclient=gws-wiz");

//   // const companyList = await page.extract({
//   //   instruction:
//   //     "Extract the list of top 5 highest-grossing animated movies from the Google search results after searching for 'top highest-grossing animated movies'",
//   //   schema: z.object({
//   //     movies: z.array(
//   //       z.object({
//   //         title: z.string(),
//   //         date: z.string(),
//   //         gross: z.string(),
//   //       }),
//   //     ),
//   //   }),
//   //   useTextExtract: false,
//   // });

//   // console.log(companyList.movies);

//   // await stagehand.page.goto("https://www.algolia.com/doc/guides/getting-started/what-is-algolia/");

//   // const results = await page.extract({
//   //   instruction:
//   //     "Scrape all the docs on this page. Go through each section and scrape the body of each section",
//   //   schema: z.object({
//   //     sections: z.array(z.object({
//   //       header: z.string(),
//   //       body: z.string(),
//   //     })),
//   //   }),
//   //   // useAccessibilityTree: true
//   // });
//   // console.log(results.sections);

//   // await stagehand.page.goto("https://google.com", {
//   //   waitUntil: "networkidle",
//   // });
//   // // timeout for 5 seconds
//   // // await stagehand.page.waitForTimeout(5000);
//   // const ingredientsSchema = z.object({
//   //   ingredients: z.array(
//   //     z.object({
//   //       name: z.string(),
//   //       amount: z.string().optional(),
//   //       unit: z.string().optional(),
//   //     }),
//   //   ),
//   // });

//   // // // Observe and click search box
//   // // const searchResults = await page.observe({
//   // //   instruction: "click the Google search input",
//   // // });
//   // // await page.act(searchResults[0]);

//   // // // Type search query
//   // // const typeResults = await page.observe({
//   // //   instruction: "type 'best brownie recipe' into the search input",
//   // // });
//   // // await page.act(typeResults[0]);

//   // // // Press enter
//   // // const enterResults = await page.observe({
//   // //   instruction: "click on the google search button",
//   // // });
//   // // await page.act(enterResults[0]);
//   // // await page.waitForLoadState("networkidle");

//   // // // Click first recipe result
//   // // const recipeResults = await page.observe({
//   // //   instruction: "click the first recipe result",

//   // // });
//   // // await page.act(recipeResults[0]);

//   // const ingredients = {
//   //   ingredients: [
//   //     {
//   //       name: "granulated sugar",
//   //       amount: "1 1/2",
//   //       unit: "cups",
//   //     },
//   //     {
//   //       name: "all-purpose flour",
//   //       amount: "3/4",
//   //       unit: "cup",
//   //     },
//   //     {
//   //       name: "cocoa powder",
//   //       amount: "2/3",
//   //       unit: "cup",
//   //     },
//   //     {
//   //       name: "powdered sugar",
//   //       amount: "1/2",
//   //       unit: "cup",
//   //     },
//   //     {
//   //       name: "dark chocolate chips",
//   //       amount: "1/2",
//   //       unit: "cup",
//   //     },
//   //     {
//   //       name: "sea salt",
//   //       amount: "3/4",
//   //       unit: "teaspoons",
//   //     },
//   //     {
//   //       name: "eggs",
//   //       amount: "2",
//   //       unit: "large",
//   //     },
//   //     {
//   //       name: "canola oil or extra-virgin olive oil",
//   //       amount: "1/2",
//   //       unit: "cup",
//   //     },
//   //     {
//   //       name: "water",
//   //       amount: "2",
//   //       unit: "tablespoons",
//   //     },
//   //     {
//   //       name: "vanilla",
//   //       amount: "1/2",
//   //       unit: "teaspoon",
//   //     },
//   //   ],
//   // };

//   // // await page.goto("https://www.loveandlemons.com/brownies-recipe/");
//   // // // Wait for the pop up to show up
//   // // await new Promise(resolve => setTimeout(resolve, 5000));
//   // // await page.act ("close the pop up");

//   // // // Extract ingredients
//   // // const recipeData = await page.extract({
//   // //   instruction: "Extract the list of ingredients for the brownie recipe. For each ingredient, get its name, amount, and unit of measurement if available.",
//   // //   schema: ingredientsSchema,
//   // //   useTextExtract: true,
//   // // });

//   // console.log(chalk.green("Found ingredients:"));
//   // console.log(JSON.stringify(ingredients, null, 2));

//   // // Navigate to Target
//   // await page.goto("https://www.target.com");
//   // await page.waitForLoadState("networkidle");

//   // // Process each ingredient
//   // for (const ingredient of ingredients.ingredients) {
//   //   // Find and click search box
//   //   const targetSearchResults = await page.observe({
//   //     instruction: "click the Target search box",

//   //   });
//   //   await page.act(targetSearchResults[0]);

//   //   // Type ingredient name
//   //   const typeIngredientResults = await page.observe({
//   //     instruction: `type '${ingredient.name}' into the search box`,

//   //   });
//   //   await page.act(typeIngredientResults[0]);
//   //   // Search
//   //   await page.keyboard.press("Enter");
//   //   // await new Promise(resolve => setTimeout(resolve, 3000));

//   //   // Add to cart the first product
//   //   const productResults = await page.observe({
//   //     instruction: "click add to cart for the first product",
//   //   });
//   //   await new Promise(resolve => setTimeout(resolve, 4000));
//   //   console.log(productResults);
//   //   await page.act(productResults[0]);
//   //   // await new Promise(resolve => setTimeout(resolve, 4000));
//   //   const finishAddToCart = await page.observe({
//   //     instruction: "close the dialog box by clicking on the add to cart link/button",
//   //   });
//   //   await page.act(finishAddToCart[0]);
//   //   // await new Promise(resolve => setTimeout(resolve, 4000));
//   //   const closeDialogResults = await page.observe({
//   //     instruction: "close the dialog box by clicking on the continue shopping button/icon",
//   //   });
//   //   console.log(closeDialogResults);
//   //   await page.act(closeDialogResults[0]);
//   // }

//   // console.log(chalk.green("Shopping complete!"));

//   // const observeRes = await stagehand.page.observe(
//   //   "find the section, not the header, that contains the global soccer scoreboard",
//   // );
//   // const observation = observeRes[0];
//   // console.log("observation: ", observation);

//   // const soccerResultsData = await stagehand.page.extract(
//   //   {
//   //     instruction:
//   //       "Extract ALL of soccer results today including the games to be played.",
//   //     schema: z.object({
//   //       soccer_results: z.array(
//   //         z.object({
//   //           teams: z.string(),
//   //           score: z.string(),
//   //           time: z.string(),
//   //         }),
//   //       ),
//   //     }),
//   //     useTextExtract: true,
//   //   },
//   //   observation,
//   // );
//   // await stagehand.close();

//   // console.log(
//   //   "the soccer results data is: ",
//   //   JSON.stringify(soccerResultsData, null, 2),
//   // );

//   //   const observeRes = await stagehand.page.observe(
//   //     "find the section/div with all the top events at the top of the page",
//   //   );
//   //   const observation = observeRes[0];
//   //   console.log("observation: ", observation);

//   //   const topEventsData = await stagehand.page.extract(
//   //     {
//   //       instruction:
//   //         "Extract ALL of the top events. Remember that games are displayed in an up-down format not left-right; this means that the each game composed by the top team and the bottom team on the page..",
//   //       schema: z.object({
//   //         top_events: z.array(
//   //           z.object({
//   //             sport: z.string(),
//   //             time: z.string(),
//   //             teams: z.string(),
//   //           }),
//   //         ),
//   //       }),
//   //       useTextExtract: true,
//   //     },
//   //     // observation,
//   //   );
//   //   await stagehand.close();

//   // console.log(
//   //   "the top events data is: ",
//   //   JSON.stringify(topEventsData, null, 2),
//   // );

//   // await page.goto("https://www.namesilo.com/phishing-report");
//   /*
//   await page.goto("https://iframetester.com/?url=https://shopify.com");
//   await new Promise((resolve) => setTimeout(resolve, 30000));
//   */

//   // await page.goto("https://tucowsdomains.com/abuse-form/phishing/");

//   // const observed = await page.observe({
//   //   instruction: "find the download google play and app store buttons",
//   // });
//   // console.log(observed);
//   // await page.act(observed[0]);

//   // const iframe_element = await page.locator("iframe").first()
//   // const iframe_url = await iframe_element.getAttribute("src")
//   // console.log(iframe_url)
//   // await page.goto(iframe_url)
//   // await new Promise(resolve => setTimeout(resolve, 10000));
//   // await new Promise(resolve => setTimeout(resolve, 10000));
//   // await page.goto("https://www.zillow.com/san-francisco-ca/rentals/2_p/?searchQueryState=%7B%22pagination%22%3A%7B%22currentPage%22%3A2%7D%2C%22isMapVisible%22%3Atrue%2C%22mapBounds%22%3A%7B%22west%22%3A-122.54216281298828%2C%22east%22%3A-122.32449618701172%2C%22south%22%3A37.68731615803958%2C%22north%22%3A37.86316318584111%7D%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A20330%2C%22regionType%22%3A6%7D%5D%2C%22filterState%22%3A%7B%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22cmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22beds%22%3A%7B%22min%22%3A1%7D%7D%2C%22isListVisible%22%3Atrue%2C%22mapZoom%22%3A12%2C%22usersSearchTerm%22%3A%22San%20Francisco%20CA%22%7D");
//   // await page.goto("https://zillow-eval.surge.sh/");

//   // await page.goto("https://www.google.com");
//   // const personName = "Miguel";
//   // const observed1= await page.observe(`find the main search bar and fill it with ${personName}'s favorite book recommendations`);
//   // await page.act(observed1[0]);
//   // await page.keyboard.press("Enter");
//   // await new Promise(resolve => setTimeout(resolve, 10000));
//   //   await page.goto("https://docs.stagehand.dev/");
//   // await stagehand.page.waitForLoadState("domcontentloaded");
//   // await page.goto("https://semantic-ui.com/modules/dropdown.html");
//   // await stagehand.page.goto("https://www.mcmaster.com/products/screws/");
//   // await stagehand.page.goto("https://vantechjournal.com/archive?page=8");

//   // await page.goto("file:///Users/miguel/Documents/Browserbase/test.html");
//   // await page.goto("https://radio-btn-no-label-test-stagehand.surge.sh/");
//   // await new Promise((resolve) => setTimeout(resolve, 10000));
//   // await getAccessibilityTree(page);
//   // // await getAccessibilityTreeV2(page);
//   // await axSnapshot(page);
//   // const { extraction } = await page.extract("Extract all the text in this website");
//   // console.log(extraction);

//   // const observations = await stagehand.page.extract({
//   //   instruction:
//   //   // "Find the one parent container element that holds links to each of the startup companies. The companies each have a name, a description, and a link to their website.",
//   //     "find all the products on this page",
//   // schema: z.object({
//   //   products: z.array(z.object({
//   //     category: z.string(),
//   //     description: z.string(),
//   //   })),
//   // }),
//   //   useTextExtract: true
//   // });
//   // console.log(observations);

//   // const iframe = await page.locator("#primary > div.singlePage > section > div > div > article > div > iframe").contentFrame();
//   // console.log(iframe);

//   // await getIframe(page, stagehand);

//   // const observed = await page.observe({
//   //   // instruction: "find all the dropdowns on this page",
//   //   // instruction: "find the immediate parent div containing the links to social and get started sections. Only go one level up from the list",
//   //   onlyVisible: false,
//   //   returnAction: true,
//   //   drawOverlay: true,
//   // });
//   // // observed[0].selector = "xpath=/html/body/div/main/div/div[2]/div[1]/div/div/div[2]"

//   // console.log(observed);

//   // await page.act("click on provider search");
//   // const extraction = await page.extract({
//   //   instruction: "extract the different elements in this container",
//   //   schema: z.object({
//   //     links: z.array(z.string()),
//   //   }),
//   //   useTextExtract: true
//   // },
//   //   // observed[0]
//   // );
//   // console.log(extraction);
//   // await page.act('click the run now button');
//   // const xpath = observed[0].selector.replace("xpath=", "");
//   // const { result } = await cdpClient.send("Runtime.evaluate", {
//   //   expression: `document.evaluate('${xpath}', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`,
//   //   returnByValue: false,
//   // });
//   // const { node } = await cdpClient.send("DOM.describeNode", {
//   //   objectId: result.objectId,
//   // });
//   // // const { node } = await cdpClient.send("DOM.describeNode", {
//   // //   objectId: result.objectId,
//   // //   depth: -1,
//   // //   pierce: true,
//   // // });
//   // const backendNodeId = node.backendNodeId;
//   // console.log(backendNodeId);

//   // await page.act(observed[0])

//   // Get the node details using CDP
//   // const { node } = await cdpClient.send("DOM.describeNode", {
//   //   objectId: result.objectId,
//   //   depth: -1,
//   //   pierce: true,
//   // });
//   // console.log(node);
//   // const observations = await stagehand.page.observe({
//   //   instruction: "Find all the form elements under the 'Income' section",
//   // });
//   // console.log(observations.length);
//   // const observed = await stagehand.page.observe({
//   //   instruction: "find the button that takes us to the 11th page",
//   // });

//   // console.log("Observed elements:", observed);
//   // console.log(observed.length);

//   // // Get the first observed result to test with
//   // if (observed.length > 0) {
//   //   // Access the private actHandler instance
//   //   const actHandler = (stagehand as any).stagehandPage.actHandler;
//   //   for (const el of observed) {
//   //     await new Promise(resolve => setTimeout(resolve, 500));
//   //     // if (el.method === 'click' || el.method === 'fill') {
//   //       await actHandler._performPlaywrightMethod(
//   //         el.method, // method
//   //         // ["mockemail@example.com"],
//   //         el.arguments, // args (empty for click)
//   //         el.selector.replace('xpath=', '') // Remove 'xpath=' prefix from selector
//   //       );
//   //     // }
//   //   }
//   // }

//   // const SEARCH_TERM = "AI Code Editor";

//   // Navigate to YC startup directory
//   // await page.goto(`https://www.ycombinator.com/companies?query=${SEARCH_TERM}`);

//   // // Extract top 3 company names
//   // const results = await page.extract({
//   //   instruction:
//   //     "extract the names of the first 3 companies from the search results",
//   //   schema: z.object({
//   //     companies: z.array(z.string()),
//   //   }),
//   //   useTextExtract: true
//   // });

//   // console.log(chalk.green("\nTop 3 companies for 'code editor with AI':"));
//   // results.companies.forEach((company, i) => {
//   //   console.log(chalk.cyan(`${i + 1}. ${company}`));
//   // });

//   // await page.goto(
//   //   "https://github.com/browserbase/stagehand/blob/main/types/stagehand.ts"
//   // );
//   // await getAccessibilityTree(page);
//   // const { actOptions } = await page.extract({
//   //   instruction: "Extract last 4 lines of the code insde the ObserveOptions interface",
//   //   schema: z.object({
//   //     actOptions: z.string(),
//   //   }),
//   //   useAccessibilityTree: true // doesn't work whether T/F
//   // });
//   // console.log(actOptions);

//   // const observations = await stagehand.page.observe({
//   //   instruction: "Find all the links on the header section",
//   //   useAccessibilityTree: true
//   // });

//   // const observations2 = await stagehand.page.observe({
//   //   instruction: "Find all the links to social media platforms",
//   //   useAccessibilityTree: true
//   // });

//   // console.log(JSON.stringify(observations, null, 2));
//   // console.log(observations.length);
//   // console.log(JSON.stringify(observations2, null, 2));
//   // console.log(observations2.length);

//   // First get the document root
//   // const { root } = await cdpClient.send('DOM.getDocument');

//   /*
//     CDP DOM.querySelector
//   */
//   // const { root: documentNode } = await cdpClient.send('DOM.getDocument');
//   // console.log(documentNode);

//   // const { nodeId } = await cdpClient.send('DOM.querySelector', {
//   //   nodeId: documentNode.backendNodeId,
//   //   selector: 'h2',
//   // });

//   // console.log('backendNodeId:', nodeId); // Log the nodeId

//   /*
//     CDP DOM.resolveNode (backendNodeId or a11y nodeId)
//   */
//   // const { object } = await cdpClient.send('DOM.resolveNode', { backendNodeId: 169 });

//   // console.log(object);
//   // const element = await stagehand.page.evaluate(() => {
//   //   const element = document;
//   //   return element
//   // });
//   // const { node } = await cdpClient.send('DOM.describeNode', {
//   //   backendNodeId: 164,
//   //   depth: 1,  // Include child nodes
//   //   pierce: true  // Pierce through shadow roots
//   // });
//   // console.log(node)

//   //   const elementDetails = await cdpClient.send('Runtime.callFunctionOn', {
//   //     objectId: object.objectId,
//   //     functionDeclaration: 'function() { return this; }',
//   //   });
//   //   console.log(elementDetails)

//   //   const element = elementDetails.result.value;

//   // const { result } = await cdpClient.send('Runtime.callFunctionOn', {
//   //   objectId: object.objectId,
//   //   functionDeclaration: 'function() { return this.textContent; }',
//   // });

//   // console.log('Text Content:', result.value);

//   // // Modify the text content of the node
//   // await cdpClient.send('Runtime.callFunctionOn', {
//   //   objectId: object.objectId,
//   //   // functionDeclaration: 'function() { this.textContent = "Modified Content!"; }',
//   //   functionDeclaration: 'function() { return this.click(); }',
//   // });

//   // await new Promise(resolve => setTimeout(resolve, 6000));

//   // const observations = await stagehand.page.observe({
//   //   instruction: "find all links to the companies in batch 2",
//   //   // instruction: "find all the links inside the manage section of the solutions tab",
//   //   // instruction: "find the last 3 listings on this page",
//   //   useAccessibilityTree: true
//   // });
//   // console.log(JSON.stringify(observations, null, 2));
//   // console.log(observations.length);

//   // // AI grant extract eval
//   // await page.goto("https://aigrant.com/");
//   // const accessibilityTree = await getAccessibilityTree(page);
//   // const companyList = await page.extract({
//   //   instruction:
//   //     "Extract all companies that received the AI grant and group them with their batch numbers as an array of objects. Each object should contain the company name and its corresponding batch number.",
//   //   schema: z.object({
//   //     companies: z.array(
//   //       z.object({
//   //         company: z.string(),
//   //         batch: z.string(),
//   //       }),
//   //     ),
//   //   }),
//   //   useTextExtract: false,
//   //   useAccessibilityTree: true
//   // });

//   // console.log(companyList.companies);
//   // console.log(companyList.companies.length);

//   // await stagehand.page.goto(
//   //   "https://www.ncc.gov.ng/technical-regulation/standards/numbering#area-codes-by-zone-primary-centre",
//   //   { waitUntil: "domcontentloaded" },
//   // );

//   // const result = await stagehand.extract({
//   //   instruction:
//   //     "Extract ALL the Primary Center names and their corresponding Area Code, and the name of their corresponding Zone.",
//   //   schema: z.object({
//   //     primary_center_list: z.array(
//   //       z.object({
//   //         zone_name: z
//   //           .string()
//   //           .describe(
//   //             "The name of the Zone that the Primary Center is in. For example, 'North Central Zone'.",
//   //           ),
//   //         primary_center_name: z
//   //           .string()
//   //           .describe(
//   //             "The name of the Primary Center. I.e., this is the name of the city or town.",
//   //           ),
//   //         area_code: z
//   //           .string()
//   //           .describe(
//   //             "The area code for the Primary Center. This will either be 2 or 3 digits.",
//   //           ),
//   //       }),
//   //     ),
//   //   }),
//   //   useTextExtract: false,
//   //   useAccessibilityTree: true
//   // });

//   // console.log(result.primary_center_list);
//   // console.log(result.primary_center_list.length);

//   // await stagehand.page.goto(
//   //   "https://www.tti.com/content/ttiinc/en/apps/part-detail.html?partsNumber=C320C104K5R5TA&mfgShortname=KEM&productId=6335148",
//   // );

//   // const result = await stagehand.extract({
//   //   instruction:
//   //     "Extract the TTI Part Number, Product Category, and minimum operating temperature of the capacitor.",
//   //   schema: z.object({
//   //     tti_part_number: z.string(),
//   //     product_category: z.string(),
//   //     min_operating_temp: z.string(),
//   //   }),
//   //   useTextExtract: false,
//   //   // useAccessibilityTree: true
//   // });

//   // console.log(result.tti_part_number);
//   // console.log(result.product_category);
//   // console.log(result.min_operating_temp);

//   // await stagehand.page.goto("https://www.landerfornyc.com/news", {
//   //   waitUntil: "networkidle",
//   // });

//   // const rawResult = await stagehand.extract({
//   //   instruction:
//   //     "extract the title and corresponding publish date of EACH AND EVERY press releases on this page. DO NOT MISS ANY PRESS RELEASES.",
//   //   schema: z.object({
//   //     items: z.array(
//   //       z.object({
//   //         title: z.string().describe("The title of the press release"),
//   //         publish_date: z
//   //           .string()
//   //           .describe("The date the press release was published"),
//   //       }),
//   //     ),
//   //   }),
//   //   useTextExtract: false,
//   //   useAccessibilityTree: true,
//   // });

//   // console.log(rawResult.items);
//   // console.log(rawResult.items.length);

//   // await stagehand.page.goto(
//   //   "https://www.sars.gov.za/legal-counsel/secondary-legislation/public-notices/",
//   //   { waitUntil: "networkidle" },
//   // );

//   // const result = await stagehand.extract({
//   //   instruction:
//   //     "Extract ALL the public notice descriptions with their corresponding, GG number and publication date. Extract ALL notices from 2024 through 2020. Do not include the Notice number.",
//   //   schema: z.object({
//   //     public_notices: z.array(
//   //       z.object({
//   //         notice_description: z
//   //           .string()
//   //           .describe(
//   //             "the description of the notice. Do not include the Notice number",
//   //           ),
//   //         gg_number: z
//   //           .string()
//   //           .describe("the GG number of the notice. For example, GG 12345"),
//   //         publication_date: z
//   //           .string()
//   //           .describe(
//   //             "the publication date of the notice. For example, 8 December 2021",
//   //           ),
//   //       }),
//   //     ),
//   //   }),
//   //   useTextExtract: false,
//   //   useAccessibilityTree: true
//   // });

//   // console.log(result.public_notices);
//   // console.log(result.public_notices.length);

//   // await stagehand.page.goto(
//   //   "http://www.dsbd.gov.za/index.php/research-reports",
//   //   { waitUntil: "load" },
//   // );

//   // const result = await stagehand.extract({
//   //   instruction:
//   //     "Extract ALL the research report names. Do not extract the names of the PDF attachments.",
//   //   schema: z.object({
//   //     reports: z.array(
//   //       z.object({
//   //         report_name: z
//   //           .string()
//   //           .describe(
//   //             "The name or title of the research report. NOT the name of the PDF attachment.",
//   //           ),
//   //       }),
//   //     ),
//   //   }),
//   //   useTextExtract: false,
//   //   useAccessibilityTree: true
//   // });

//   // console.log(result.reports);
//   // console.log(result.reports.length);

//   // await stagehand.page.goto(
//   //   "https://www.cbisland.com/blog/10-snowshoeing-adventures-on-cape-breton-island/",
//   // );

//   // const snowshoeing_regions = await stagehand.extract({
//   //   instruction:
//   //     "Extract all the snowshoeing regions and the names of the trails within each region.",
//   //   schema: z.object({
//   //     snowshoeing_regions: z.array(
//   //       z.object({
//   //         region_name: z
//   //           .string()
//   //           .describe("The name of the snowshoeing region"),
//   //         trails: z
//   //           .array(
//   //             z.object({
//   //               trail_name: z.string().describe("The name of the trail"),
//   //             }),
//   //           )
//   //           .describe("The list of trails available in this region."),
//   //       }),
//   //     ),
//   //   }),
//   //   useTextExtract: true,
//   //   // useAccessibilityTree: true
//   // });

//   // console.log(snowshoeing_regions.snowshoeing_regions);
//   // console.log(snowshoeing_regions.snowshoeing_regions.length);

//   // await page.goto("https://panamcs.org/about/staff/");

//   // const result = await page.extract({
//   //   instruction:
//   //     "extract a list of staff members on this page, with their name and their job title",
//   //   schema: z.object({
//   //     staff_members: z.array(
//   //       z.object({
//   //         name: z.string(),
//   //         job_title: z.string(),
//   //       }),
//   //     ),
//   //   }),
//   //   useTextExtract:false,
//   //   useAccessibilityTree: true
//   // });

//   // const staff_members = result.staff_members;
//   // console.log(JSON.stringify(staff_members, null, 2));
//   // console.log(staff_members.length);

//   // const accessibilitySources = await getAccessibilityTree(stagehand.page);
//   // const meaningfulNodes = accessibilitySources
//   //   .filter(node => {
//   //       const name = node.name?.trim();
//   //       return Boolean(
//   //           name &&
//   //           name !== '' &&
//   //           name !== '[]' &&
//   //           node.role?.trim() &&
//   //           !/[\u{0080}-\u{FFFF}]/u.test(name)
//   //       );
//   //   })
//   //   .map(node => ({
//   //       role: node.role,
//   //       name: node.name.replace(/[\u{0080}-\u{FFFF}]/gu, '').trim(),
//   //       // ...(node.properties && node.properties.length > 0 && { properties: node.properties }),
//   //       // ...(node.description && { description: node.description })
//   //   }));

//   // console.log('Meaningful Nodes:', JSON.stringify(meaningfulNodes, null, 2));
//   // console.log(meaningfulNodes.length);

//   // await stagehand.page.goto(
//   //   "https://www.cbisland.com/blog/10-snowshoeing-adventures-on-cape-breton-island/",
//   // );

//   // // await stagehand.act({ action: "reject the cookies" });
//   // await new Promise(resolve => setTimeout(resolve, 2000));

//   // const accessibilitySources = await getAccessibilityTree(stagehand.page);
//   // const meaningfulNodes = accessibilitySources
//   //       .filter(node => {
//   //         return node.role !== 'none'
//   //       })
//   //       // .filter(node => {
//   //       //     const name = node.name;
//   //       //     return Boolean(
//   //       //         name &&
//   //       //         name !== '' &&
//   //       //         name !== 'undefined'
//   //       //         // node.role?.trim() &&
//   //       //         // !/[\u{0080}-\u{FFFF}]/u.test(name)
//   //       //     );
//   //       // })
//   //       .map(node => ({
//   //           role: node.role,
//   //           name: node.name,
//   //           // name: node.name.replace(/[\u{0080}-\u{FFFF}]/gu, '').trim(),
//   //           // ...(node.properties && node.properties.length > 0 && { properties: node.properties }),
//   //           // ...(node.description && { description: node.description })
//   //       }));
//   // // console.log(accessibilitySources.slice(400, 500));
//   // console.log(meaningfulNodes.slice(300, 500));

//   await new Promise((resolve) => setTimeout(resolve, 200000));
//   await stagehand.close();
// }

// (async () => {
//   try {
//     await main();
//   } catch (error) {
//     console.error(error);
//   }
// })();
