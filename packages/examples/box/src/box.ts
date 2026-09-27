import type { DownloadedFile } from "./browserbase.js";
import { metadataValues, type ExtractionAnswer } from "./compliance.js";

export type BoxFile = {
  id: string;
  name: string;
};

export type BoxAiAskResponse = {
  answer: string;
  citations?: Array<{
    id: string;
    name?: string;
    content?: string;
    type: string;
  }>;
};

export type BoxAiExtractResponse = {
  answer: ExtractionAnswer;
  confidence_score?: Record<string, unknown>;
  reference?: Record<string, unknown>;
};

async function responseError(response: Response, action: string) {
  throw new Error(
    `${action} failed (${response.status} ${response.statusText}): ${await response.text()}`,
  );
}

function field(key: string, displayName: string, prompt: string, type = "string") {
  return { key, displayName, prompt, type };
}

export const SDS_FIELDS = [
  field("productName", "Product name", "The product identifier or product name."),
  field("manufacturer", "Manufacturer", "The supplier or manufacturer name."),
  field(
    "epaRegistrationNumber",
    "EPA registration number",
    "The EPA pesticide registration number, preserving its printed punctuation.",
  ),
  field("revisionDate", "Revision date", "The document revision date.", "date"),
  field(
    "emergencyPhone",
    "Emergency phone",
    "The medical or transportation emergency phone number.",
  ),
  field("recommendedUse", "Recommended use", "The recommended product use."),
  field("hazards", "Hazards", "The primary hazards or hazard statements."),
  field("ppe", "PPE", "Required personal protective equipment."),
  field("storageRequirements", "Storage requirements", "The conditions required for safe storage."),
];

export const LABEL_FIELDS = [
  field("productName", "Product name", "The product name shown on the label."),
  field(
    "epaRegistrationNumber",
    "EPA registration number",
    "The EPA registration number shown on the label, preserving punctuation.",
  ),
  field("signalWord", "Signal word", "The signal word, such as Danger or Caution."),
  field("activeIngredients", "Active ingredients", "The active ingredients."),
  field("contactTime", "Contact time", "The required wet contact or dwell time."),
  field("firstAid", "First aid", "The first-aid instructions."),
  field("directions", "Directions", "The directions for use."),
  field("storageAndDisposal", "Storage and disposal", "The storage and disposal instructions."),
];

export async function boxAccessToken(): Promise<string> {
  const response = await fetch("https://api.box.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.BOX_CLIENT_ID as string,
      client_secret: process.env.BOX_CLIENT_SECRET as string,
      box_subject_type: "enterprise",
      box_subject_id: process.env.BOX_ENTERPRISE_ID as string,
    }),
  });

  if (!response.ok) {
    await responseError(response, "Authenticating with Box");
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("Box did not return an access token.");
  }
  return body.access_token;
}

export async function uploadToBox(
  token: string,
  file: DownloadedFile,
  role: "sds" | "label",
): Promise<BoxFile> {
  const extensionIndex = file.filename.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? file.filename.slice(extensionIndex) : "";
  const name = `browserbase-${role}-${Date.now()}${extension}`;
  const form = new FormData();
  form.append(
    "attributes",
    JSON.stringify({
      name,
      parent: { id: process.env.BOX_FOLDER_ID as string },
    }),
  );
  form.append("file", new Blob([file.bytes], { type: file.mimeType }), name);

  const response = await fetch("https://upload.box.com/api/2.0/files/content", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });

  if (!response.ok) {
    await responseError(response, `Uploading ${file.filename} to Box`);
  }

  const body = (await response.json()) as { entries: BoxFile[] };
  const uploaded = body.entries[0];
  if (!uploaded) {
    throw new Error(`Box did not return an uploaded file for ${file.filename}.`);
  }

  console.log(`Uploaded ${uploaded.name} to Box (file ${uploaded.id})`);
  return uploaded;
}

async function boxAiRequest<T>(
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`https://api.box.com/2.0${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    const retryable =
      response.status === 400 ||
      response.status === 412 ||
      response.status === 429 ||
      response.status >= 500;
    if (attempt < maxAttempts && retryable) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const delayMs =
        Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter * 1_000
          : Math.min(2 ** attempt * 1_000, 30_000);
      console.log(
        `Box AI is not ready yet; retrying in ${Math.ceil(delayMs / 1_000)}s ` +
          `(${attempt}/${maxAttempts})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    await responseError(response, `Calling Box AI ${path}`);
  }

  throw new Error(`Calling Box AI ${path} exhausted all retries.`);
}

export function askBox(token: string, file: BoxFile) {
  return boxAiRequest<BoxAiAskResponse>(token, "/ai/ask", {
    mode: "single_item_qa",
    prompt:
      "Summarize the safe handling, storage, personal protective equipment, and emergency response requirements in this safety data sheet.",
    items: [{ type: "file", id: file.id }],
    include_citations: true,
  });
}

export function extractBoxMetadata(
  token: string,
  file: BoxFile,
  fields: ReturnType<typeof field>[],
) {
  return boxAiRequest<BoxAiExtractResponse>(token, "/ai/extract_structured", {
    items: [{ type: "file", id: file.id }],
    fields,
    include_confidence_score: true,
    include_reference: true,
  });
}

export async function applyGlobalProperties(
  token: string,
  file: BoxFile,
  properties: Record<string, unknown>,
) {
  const response = await fetch(
    `https://api.box.com/2.0/files/${file.id}/metadata/global/properties`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(metadataValues(properties)),
    },
  );

  if (!response.ok) {
    await responseError(response, `Applying metadata to ${file.name}`);
  }
}
