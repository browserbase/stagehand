import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const extract_jfk_links: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/jfk/",
    );

    const extraction = await stagehand.page.extract({
      instruction:
        "extract all the record file name and their corresponding links",
      schema: z.object({
        records: z.array(
          z.object({
            file_name: z.string().describe("the file name of the record"),
            link: z.string().url(),
          }),
        ),
      }),
    });

    // The list of records we expect to see
    const expectedRecords = [
      {
        file_name: "104-10003-10041.pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041.pdf",
      },
      {
        file_name: "104-10004-10143 (C06932208).pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10004-10143%20(C06932208).pdf",
      },
      {
        file_name: "104-10004-10143.pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10004-10143.pdf",
      },
      {
        file_name: "104-10004-10156.pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10004-10156.pdf",
      },
      {
        file_name: "104-10004-10213.pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10004-10213.pdf",
      },
      {
        file_name: "104-10005-10321.pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10005-10321.pdf",
      },
      {
        file_name: "104-10006-10247.pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10006-10247.pdf",
      },
      {
        file_name: "104-10007-10345.pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10007-10345.pdf",
      },
      {
        file_name: "104-10009-10021.pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10009-10021.pdf",
      },
      {
        file_name: "104-10009-10222.pdf",
        link: "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10009-10222.pdf",
      },
    ];

    const extractedRecords = extraction.records;

    // Check that all expected records exist in the extraction
    const missingRecords = expectedRecords.filter((expected) => {
      return !extractedRecords.some(
        (r) => r.file_name === expected.file_name && r.link === expected.link,
      );
    });

    // Check that the extraction array is exactly length 10
    if (extractedRecords.length !== 10) {
      return {
        _success: false,
        reason: `Extraction has ${extractedRecords.length} records (expected 10).`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    if (missingRecords.length > 0) {
      return {
        _success: false,
        reason: "Missing one or more expected records.",
        missingRecords,
        extractedRecords,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    // If we reach here, the number of records is correct, and all are present
    return {
      _success: true,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
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
