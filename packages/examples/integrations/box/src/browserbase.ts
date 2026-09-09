import { Stagehand } from "@browserbasehq/stagehand";

type Source = {
  role: "sds" | "label";
  pageUrl: string;
  linkText: string;
};

export const sources: Source[] = [
  {
    role: "sds",
    pageUrl:
      process.env.SDS_PAGE_URL ??
      "https://www.thecloroxcompany.com/sds/clorox-disinfecting-wipes1-fresh-scent/",
    linkText: process.env.SDS_LINK_TEXT ?? "Download Safety Data Sheet",
  },
  {
    role: "label",
    pageUrl:
      process.env.LABEL_PAGE_URL ??
      "https://www.epa.gov/pesticide-labels/sample-pesticide-label-current-and-ghs-requirements",
    linkText:
      process.env.LABEL_LINK_TEXT ?? "Sample Pesticide Label with Current and GHS Requirements",
  },
];

type BrowserbaseDownload = {
  id: string;
  sessionId: string;
  filename: string;
  mimeType: string;
  size: number;
  checksum: string;
  createdAt: string;
};

export type DownloadedFile = BrowserbaseDownload & {
  bytes: ArrayBuffer;
};

async function responseError(response: Response, action: string) {
  throw new Error(
    `${action} failed (${response.status} ${response.statusText}): ${await response.text()}`,
  );
}

async function triggerDownload(stagehand: Stagehand, source: Source) {
  const page = stagehand.context.pages()[0];
  console.log(`\nOpening ${source.pageUrl}`);
  await page.goto(source.pageUrl, {
    waitUntil: "domcontentloaded",
    timeoutMs: 60_000,
  });

  const [action] = await stagehand.observe(
    `Find the link named "${source.linkText}" that downloads the document.`,
  );
  if (!action) {
    throw new Error(`Stagehand could not find the ${source.linkText} link.`);
  }

  await stagehand.act(action);
  console.log(`Stagehand clicked ${source.linkText}`);
}

async function listDownloads(
  sessionId: string,
  createdAfter: string,
): Promise<BrowserbaseDownload[]> {
  const query = new URLSearchParams({
    sessionId,
    createdAfter,
    limit: "20",
  });
  const response = await fetch(`https://api.browserbase.com/v1/downloads?${query}`, {
    headers: {
      "x-bb-api-key": process.env.BROWSERBASE_API_KEY as string,
    },
  });

  if (!response.ok) {
    await responseError(response, "Listing Browserbase downloads");
  }

  const body = (await response.json()) as {
    downloads: BrowserbaseDownload[];
  };
  return body.downloads.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function waitForDownload(
  sessionId: string,
  createdAfter: string,
  seenDownloadIds: Set<string>,
): Promise<BrowserbaseDownload> {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const downloads = await listDownloads(sessionId, createdAfter);
    const download = downloads.find((candidate) => !seenDownloadIds.has(candidate.id));
    if (download) {
      return download;
    }

    console.log("Waiting for Browserbase cloud sync...");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error("Browserbase did not sync the download within 30 seconds.");
}

async function getDownload(download: BrowserbaseDownload): Promise<DownloadedFile> {
  const response = await fetch(`https://api.browserbase.com/v1/downloads/${download.id}`, {
    headers: {
      "x-bb-api-key": process.env.BROWSERBASE_API_KEY as string,
      accept: "application/octet-stream",
    },
  });

  if (!response.ok) {
    await responseError(response, `Retrieving ${download.filename}`);
  }

  return { ...download, bytes: await response.arrayBuffer() };
}

export async function downloadWithStagehand() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
  });
  await stagehand.init();
  const sessionId = stagehand.browserbaseSessionID;
  if (!sessionId) {
    await stagehand.close();
    throw new Error("Stagehand did not return a Browserbase session ID.");
  }

  try {
    await stagehand.context.pages()[0].sendCDP("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: "downloads",
      eventsEnabled: true,
    });
    console.log(`Watch the browser live: https://browserbase.com/sessions/${sessionId}`);

    const files: DownloadedFile[] = [];
    const seenDownloadIds = new Set<string>();
    for (const source of sources) {
      const startedAt = new Date(Date.now() - 1_000).toISOString();
      await triggerDownload(stagehand, source);
      const download = await waitForDownload(sessionId, startedAt, seenDownloadIds);
      seenDownloadIds.add(download.id);
      const file = await getDownload(download);
      files.push(file);
      console.log(`Browserbase synced ${file.filename} (${file.size} bytes)`);
    }

    return { sessionId, stagehand, files };
  } catch (error) {
    await stagehand.close();
    throw error;
  }
}
