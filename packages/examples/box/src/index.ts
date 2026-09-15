import "dotenv/config";

import {
  applyGlobalProperties,
  askBox,
  boxAccessToken,
  extractBoxMetadata,
  LABEL_FIELDS,
  SDS_FIELDS,
  uploadToBox,
} from "./box.js";
import { downloadWithStagehand, sources } from "./browserbase.js";
import { decideCompliance } from "./compliance.js";

async function main() {
  console.log("Starting Browserbase + Box compliance intake...");
  const token = await boxAccessToken();
  const { stagehand, sessionId, files } = await downloadWithStagehand();

  try {
    if (files.length < sources.length) {
      throw new Error(`Expected ${sources.length} files, received ${files.length}.`);
    }

    const [sdsFile, labelFile] = await Promise.all([
      uploadToBox(token, files[0], "sds"),
      uploadToBox(token, files[1], "label"),
    ]);
    const [qa, sdsExtraction, labelExtraction] = await Promise.all([
      askBox(token, sdsFile),
      extractBoxMetadata(token, sdsFile, SDS_FIELDS),
      extractBoxMetadata(token, labelFile, LABEL_FIELDS),
    ]);
    const decision = decideCompliance(sdsExtraction.answer, labelExtraction.answer);

    await Promise.all([
      applyGlobalProperties(token, sdsFile, {
        ...sdsExtraction.answer,
        browserbaseSessionId: sessionId,
        documentRole: "safety_data_sheet",
        complianceStatus: decision.status,
        sourceUrl: sources[0].pageUrl,
      }),
      applyGlobalProperties(token, labelFile, {
        ...labelExtraction.answer,
        browserbaseSessionId: sessionId,
        documentRole: "product_label",
        complianceStatus: decision.status,
        sourceUrl: sources[1].pageUrl,
      }),
    ]);

    console.log("\n=== Box AI Q&A ===");
    console.log(qa.answer);
    if (qa.citations?.length) {
      console.log("Citations:");
      for (const citation of qa.citations) {
        console.log(`- ${citation.name ?? citation.id}: ${citation.content ?? ""}`);
      }
    }

    console.log("\n=== Extracted SDS metadata ===");
    console.log(JSON.stringify(sdsExtraction, null, 2));
    console.log("\n=== Extracted label metadata ===");
    console.log(JSON.stringify(labelExtraction, null, 2));
    console.log("\n=== Compliance decision ===");
    console.log(JSON.stringify(decision, null, 2));
    console.log("\nBox files:");
    console.log(`- https://app.box.com/file/${sdsFile.id}`);
    console.log(`- https://app.box.com/file/${labelFile.id}`);
  } finally {
    await stagehand.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
