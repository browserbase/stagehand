// server/expressServer.ts

import express, { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";

export function createExpressServer(
  htmlContent: string,
  resources: {
    name: string;
    content: Buffer;
    contentType: string;
    contentLocation: string;
  }[], // Update the type
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
  app.get("/", (req: Request, res: Response) => {
    let modifiedHtml = htmlContent;

    // Modify resource links to point to the local server
    resources.forEach((resource) => {
      const originalUrl = resource.contentLocation; // Use full URL
      const localUrl = `/static/${resource.name}`;
      modifiedHtml = modifiedHtml.replace(
        new RegExp(originalUrl, "g"),
        localUrl,
      );
    });

    res.send(modifiedHtml);
  });

  // Cleanup function to delete files
  const cleanup = () => {
    resources.forEach((resource) => {
      const resourcePath = path.join(publicDir, resource.name);
      if (fs.existsSync(resourcePath)) {
        fs.unlinkSync(resourcePath);
      }
    });
  };

  // Call cleanup when the server is closed
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit();
  });

  return app;
}
