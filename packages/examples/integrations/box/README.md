# Browserbase + Box AI Compliance Intake

This example uses Browserbase to download a safety data sheet and product label
from the web, uploads both files to Box, and turns them into an agentic
compliance workflow with Box AI.

The default sources are a Clorox safety data sheet and an EPA sample pesticide
label. They intentionally demonstrate how an agent can identify a packet that
needs human review. Override the source variables in `.env` to process a matching
SDS and label pair.

## What it demonstrates

1. Stagehand opens real manufacturer and government web pages in a Browserbase session.
2. The remote browser downloads both PDFs to Browserbase cloud storage.
3. The Browserbase Downloads API returns the original file bytes.
4. The files are uploaded to Box.
5. `POST /ai/ask` answers safety questions about the SDS with citations.
6. `POST /ai/extract_structured` extracts structured metadata from the label
   document, including text embedded in the label artwork.
7. A deterministic agent checks the extracted EPA registration numbers and SDS
   revision date.
8. The extraction and decision are saved on each Box file using the global
   `properties` metadata template.

## Prerequisites

- Node.js 18 or newer
- A Browserbase API key
- A Box Server App using Client Credentials Grant with:
  - Read and write access to files and folders
  - Manage AI enabled
- A Box folder shared with the app's service account using the **Editor** role
- A Box plan with access to the Box AI API

In the [Box Developer Console](https://app.box.com/developers/console), create a
**Server** app using **Client Credentials Grant**, enable the required scopes, and
authorize it. Copy its Client ID, Client Secret, and Enterprise ID into `.env`.
The demo exchanges those credentials for a temporary service-account access token
at runtime, so it does not require an interactive login or a Developer Token.

Copy the service account email from the app's details, share a project folder with
that account using the **Editor** role, and set `BOX_FOLDER_ID` to the number in the
folder's Box URL. The agent can access only content available to its service account.

## Run it

```bash
cd examples/integrations/box/stagehand
pnpm install --ignore-workspace
cp .env.example .env
# Fill in Browserbase and Box credentials.
pnpm start
```

The command prints:

- A Browserbase Session Inspector URL
- The cited Box AI answer
- Extracted metadata, confidence scores, and source references
- The compliance decision
- Links to the uploaded Box files

## Configuration

| Variable              | Required | Description                                        |
| --------------------- | -------- | -------------------------------------------------- |
| `BROWSERBASE_API_KEY` | Yes      | Browserbase browser and Model Gateway API key      |
| `BOX_CLIENT_ID`       | Yes      | Box Server App client ID                           |
| `BOX_CLIENT_SECRET`   | Yes      | Box Server App client secret                       |
| `BOX_ENTERPRISE_ID`   | Yes      | Enterprise that owns the app's service account     |
| `BOX_FOLDER_ID`       | Yes      | Destination folder shared with the service account |
| `SDS_PAGE_URL`        | No       | Web page containing the SDS link                   |
| `SDS_LINK_TEXT`       | No       | Accessible name of the SDS download link           |
| `LABEL_PAGE_URL`      | No       | Web page containing the product-label link         |
| `LABEL_LINK_TEXT`     | No       | Accessible name of the label download link         |

The source link must initiate a browser download. Stagehand clicks it normally,
and the Browserbase Downloads API exposes the resulting file.

New Box files can take a short time to become available to Box AI. The demo
retries transient readiness, rate-limit, and server responses with bounded
exponential backoff before failing.

## Why structured extraction

Box's freeform `POST /ai/extract` endpoint does not perform OCR. This example uses
`POST /ai/extract_structured`, which supports OCR for scanned PDFs and image files
such as TIFF, PNG, and JPEG. It also returns confidence scores and references that
an agent can use to decide when human review is required.

Box AI does not process a mixed text-and-image packet as one multimodal request.
The example therefore asks questions about the SDS, extracts each file separately,
and compares the structured results in application code.

## Useful documentation

- [Browserbase downloads](https://docs.browserbase.com/platform/browser/files/downloads)
- [Stagehand](https://docs.stagehand.dev/v3/first-steps/quickstart)
- [Box file uploads](https://developer.box.com/reference/post-files-content)
- [Connect an AI agent to Box](https://developer.box.com/tutorials/connect-an-agent-to-box)
- [Box Client Credentials Grant](https://developer.box.com/guides/authentication/client-credentials)
- [Box AI Q&A](https://developer.box.com/reference/post-ai-ask)
- [Box AI structured extraction](https://developer.box.com/reference/post-ai-extract-structured)
- [Box metadata instances](https://developer.box.com/guides/metadata/instances/create)
