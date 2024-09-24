// server/expressServer.ts

import express, { Express } from "express";
import path from "path";
import fs from "fs";

export function createExpressServer(
  htmlContent: string,
  resources: { name: string; content: Buffer; contentType: string }[],
): Express {
  const app = express();
  const publicDir = path.join(__dirname, "public");

  // Ensure the public directory exists
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
  }

  // Save resources to the public directory
  resources.forEach((resource) => {
    const resourcePath = path.join(publicDir, resource.name);
    fs.writeFileSync(resourcePath, resource.content);
  });

  // Serve static files
  app.use("/static", express.static(publicDir));

  // Serve the HTML content
  app.get("/", (req, res) => {
    let modifiedHtml = htmlContent;

    // Modify resource links to point to the local server
    resources.forEach((resource) => {
      const originalUrl = resource.name; // Adjust based on how resources are referenced
      const localUrl = `/static/${resource.name}`;
      modifiedHtml = modifiedHtml.replace(
        new RegExp(originalUrl, "g"),
        localUrl,
      );
    });

    res.send(modifiedHtml);
  });

  return app;
}
