// utils/mhtmlParser.ts

import fs from "fs";
import path from "path";

/**
 * Interface representing a parsed MHTML object.
 */
interface Resource {
  name: string;
  content: Buffer;
  contentType: string;
  contentLocation: string; // Add this line
}

interface ParsedMHTML {
  html: string;
  resources: Resource[];
}

/**
 * Decodes a quoted-printable encoded string into a UTF-8 string.
 * @param input - The quoted-printable encoded string.
 * @returns The decoded UTF-8 string.
 */
function decodeQuotedPrintable(input: string): string {
  // Replace soft line breaks (= followed by CRLF or LF)
  input = input.replace(/=\r?\n/g, "");

  // Replace =XX with the corresponding byte
  const byteArray: number[] = [];
  const regex = /=([A-Fa-f0-9]{2})/g;
  let match: RegExpExecArray | null;

  let lastIndex = 0;
  while ((match = regex.exec(input)) !== null) {
    // Push the preceding characters as they are
    if (match.index > lastIndex) {
      const preceding = input.slice(lastIndex, match.index);
      for (const char of preceding) {
        byteArray.push(char.charCodeAt(0));
      }
    }

    // Push the decoded byte
    byteArray.push(parseInt(match[1], 16));
    lastIndex = regex.lastIndex;
  }

  // Push any remaining characters after the last match
  if (lastIndex < input.length) {
    const remaining = input.slice(lastIndex);
    for (const char of remaining) {
      byteArray.push(char.charCodeAt(0));
    }
  }

  // Convert the byte array to a Buffer and decode as UTF-8
  const buffer = Buffer.from(byteArray);
  const decoded = buffer.toString("utf-8");

  console.log("Decoded Quoted-Printable Content:", decoded);
  return decoded;
}

/**
 * Parses an MHTML string into its constituent parts.
 * @param mhtmlContent - The raw MHTML content as a string.
 * @returns A ParsedMHTML object containing the HTML and resources.
 */
export function parseMHTML(mhtmlContent: string): ParsedMHTML {
  console.log("Parsing MHTML Content...");
  console.log(mhtmlContent);

  // Normalize line endings to \r\n
  const normalizedContent = mhtmlContent.replace(/\r?\n/g, "\r\n");

  // Extract the boundary from the Content-Type header
  const boundaryMatch = normalizedContent.match(/boundary="([^"]+)"/i);
  if (!boundaryMatch) {
    throw new Error("Boundary not found in MHTML content.");
  }
  const boundary = boundaryMatch[1];
  const boundaryDelimiter = `--${boundary}`;

  console.log("Extracted Boundary:", boundary);
  console.log("Boundary Delimiter:", boundaryDelimiter);

  // Split the content into parts
  const parts = normalizedContent.split(boundaryDelimiter).slice(1, -1); // Exclude the first empty and last '--'

  console.log(`Number of MIME parts found: ${parts.length}`);

  // Initialize variables to hold HTML and resources
  let htmlParts: string[] = [];
  const resources: { name: string; content: Buffer; contentType: string }[] =
    [];

  // Helper function to parse headers
  const parseHeaders = (headerPart: string) => {
    const headers: Record<string, string> = {};
    const headerLines = headerPart.split("\r\n");
    headerLines.forEach((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex !== -1) {
        const key = line.substring(0, separatorIndex).trim().toLowerCase();
        const value = line.substring(separatorIndex + 1).trim();
        headers[key] = value;
      }
    });
    return headers;
  };

  // Process each part
  parts.forEach((part, index) => {
    const splitIndex = part.indexOf("\r\n\r\n");
    if (splitIndex === -1) {
      console.warn(`Unable to split headers and body for part index: ${index}`);
      return;
    }

    const rawHeaders = part.substring(0, splitIndex);
    const body = part.substring(splitIndex + 4).trim();

    const headers = parseHeaders(rawHeaders);

    console.log(`\n--- Part ${index} Headers ---`);
    console.log(headers);
    console.log(`--- Part ${index} Body ---`);
    console.log(body.substring(0, 100)); // Log first 100 chars

    // Get Content-Type
    const contentType = headers["content-type"] || "application/octet-stream";

    // Get Content-Location or Content-Transfer-Encoding if available
    const contentLocation = headers["content-location"] || "";
    const contentTransferEncoding =
      headers["content-transfer-encoding"] || "7bit";

    // Decode body based on Content-Transfer-Encoding
    let bufferContent: Buffer;
    if (contentTransferEncoding.toLowerCase() === "base64") {
      bufferContent = Buffer.from(body, "base64");
    } else if (contentTransferEncoding.toLowerCase() === "quoted-printable") {
      const decoded = decodeQuotedPrintable(body);
      bufferContent = Buffer.from(decoded, "utf-8");
    } else {
      // For other encodings like '7bit', '8bit', etc.
      bufferContent = Buffer.from(body, "binary");
    }

    if (contentType.startsWith("text/html")) {
      const decodedHtml = bufferContent.toString("utf-8").trim();
      if (decodedHtml) {
        // Only add non-empty HTML parts
        htmlParts.push(decodedHtml);
        console.log(`HTML part found in part index: ${index}`);
        console.log(`HTML part content length: ${decodedHtml.length}`);
        console.log(
          `HTML part content snippet: ${decodedHtml.substring(
            0,
            Math.min(100, decodedHtml.length),
          )}...`,
        );
      } else {
        console.warn(`Empty HTML part found in part index: ${index}`);
      }
    } else {
      const name =
        path.basename(contentLocation) || `resource-${resources.length}`;
      resources.push({
        name,
        content: bufferContent,
        contentType,
        contentLocation, // Add this line
      });
      console.log(`Resource part found: ${name}`);
    }
  });

  // Concatenate all HTML parts
  const html = htmlParts.join("\n").trim();

  console.log(`\n--- Final HTML ---`);
  console.log(html.substring(0, Math.min(500, html.length)) + "...");

  console.log(`Final HTML Content Length: ${html.length}`);

  if (!html) {
    throw new Error("HTML part not found in MHTML content.");
  }

  return { html, resources };
}

/**
 * Reads and parses an MHTML file from the given file path.
 * @param filePath - The path to the MHTML file.
 * @returns A promise that resolves to a ParsedMHTML object.
 */
export async function parseMHTMLFile(filePath: string): Promise<ParsedMHTML> {
  const mhtmlContent = fs.readFileSync(filePath, "utf-8");
  return parseMHTML(mhtmlContent);
}
