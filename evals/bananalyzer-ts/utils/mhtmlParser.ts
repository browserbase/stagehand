// utils/mhtmlParser.ts

import fs from "fs";
import path from "path";
import { parseMHTML } from "mhtml-parser"; // Ensure this package exists or use an alternative

interface ParsedMHTML {
  html: string;
  resources: { name: string; content: Buffer; contentType: string }[];
}

export async function parseMHTMLFile(filePath: string): Promise<ParsedMHTML> {
  const mhtmlContent = fs.readFileSync(filePath, "utf-8");
  const parsed = parseMHTML(mhtmlContent); // Implement or use a suitable parser

  const htmlPart = parsed.parts.find(
    (part: any) =>
      part.mimeType === "text/html" ||
      part.contentLocation === "https://asim-shrestha.com/",
  );

  if (!htmlPart) {
    throw new Error("HTML part not found in MHTML file.");
  }

  const resources = parsed.parts
    .filter((part: any) => part.mimeType !== "text/html")
    .map((part: any) => ({
      name: part.contentLocation.split("/").pop() || "resource",
      content: part.content, // Assuming content is a Buffer
      contentType: part.mimeType,
    }));

  return {
    html: htmlPart.content.toString("utf-8"),
    resources,
  };
}
