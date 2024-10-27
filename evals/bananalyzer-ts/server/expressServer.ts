import express, { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { parseMHTMLFile } from "../utils/mhtmlParser";
import * as cheerio from "cheerio";
import { URL } from "url";

const publicDir = path.join(__dirname, "public");

// Ensure the public directory exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

export function createExpressServer(): Express {
  const app = express();

  app.use(express.json());

  app.use("/static", express.static(publicDir));

  // Endpoint to add MHTML content
  app.post("/add-mhtml", async (req: Request, res: Response) => {
    const { mhtmlFilePath } = req.body;

    if (!mhtmlFilePath) {
      return res.status(400).send("Missing mhtmlFilePath");
    }

    try {
      const parsedMHTML = await parseMHTMLFile(mhtmlFilePath);

      const exampleId = path.basename(path.dirname(mhtmlFilePath));
      const exampleDir = path.join(publicDir, exampleId);

      if (!fs.existsSync(exampleDir)) {
        fs.mkdirSync(exampleDir, { recursive: true });
      }

      parsedMHTML.resources.forEach((resource) => {
        try {
          // Use the correct property, e.g., 'contentLocation'
          const resourceURL = new URL(resource.contentLocation);
          const relativePath = resourceURL.pathname.startsWith("/")
            ? resourceURL.pathname.slice(1) // Remove leading "/"
            : resourceURL.pathname;

          // Define the full path within the example directory
          const resourcePath = path.join(exampleDir, relativePath);
          const resourceDir = path.dirname(resourcePath);

          // Ensure the resource directory exists
          if (!fs.existsSync(resourceDir)) {
            fs.mkdirSync(resourceDir, { recursive: true });
          }

          // Write the resource content to the specified path
          fs.writeFileSync(resourcePath, resource.content);
        } catch (resourceError) {
          console.error(
            `Failed to save resource ${resource.contentLocation}:`,
            resourceError,
          );
        }
      });

      // Modify HTML to point resource URLs to the local server
      const $ = cheerio.load(parsedMHTML.html);

      // Update all <link>, <script>, and <img> tags
      ["link[href]", "script[src]", "img[src]"].forEach((selector) => {
        $(selector).each((_, elem) => {
          const attribute = selector.includes("href") ? "href" : "src";
          const url = $(elem).attr(attribute);
          if (url && url.startsWith("https://asim-shrestha.com/")) {
            try {
              const resourceURL = new URL(url);
              const relativePath = resourceURL.pathname.startsWith("/")
                ? resourceURL.pathname.slice(1) // Remove leading "/"
                : resourceURL.pathname;
              const localPath = `/static/${exampleId}/${relativePath}`;
              $(elem).attr(attribute, localPath);
            } catch (urlError) {
              console.error(`Failed to process URL ${url}:`, urlError);
            }
          }
        });
      });

      const modifiedHtml = $.html();

      // Save the modified HTML
      const htmlPath = path.join(exampleDir, "index.html");
      fs.writeFileSync(htmlPath, modifiedHtml);

      res.json({
        htmlContent: modifiedHtml,
        resources: parsedMHTML.resources,
      });
    } catch (error) {
      console.error("Error parsing MHTML file:", error);
      res.status(500).send("Error parsing MHTML file");
    }
  });

  // Endpoint to delete resources
  app.delete("/delete-resources", (req: Request, res: Response) => {
    try {
      const { exampleId } = req.body;
      const exampleDir = path.join(publicDir, exampleId);
      if (fs.existsSync(exampleDir)) {
        fs.rmdirSync(exampleDir, { recursive: true });
      }
      res.status(200).send("Resources deleted successfully");
    } catch (error) {
      console.error("Error deleting resources:", error);
      res.status(500).send("Error deleting resources");
    }
  });

  // Error handling middleware
  app.use((err: any, req: Request, res: Response, next: Function) => {
    console.error(err.stack);
    res.status(500).send("Something broke!");
  });

  /**
   * Cleanup function to remove the public directory.
   */
  const cleanup = () => {
    try {
      if (fs.existsSync(publicDir)) {
        fs.rmdirSync(publicDir, { recursive: true });
        console.log(`Cleaned up public directory: ${publicDir}`);
      }
      process.exit(0);
    } catch (err) {
      console.error(`Error during cleanup:`, err);
      process.exit(1);
    }
  };

  // Listen for termination signals to perform cleanup
  process.on("SIGINT", () => {
    console.log("Received SIGINT. Cleaning up before shutdown...");
    cleanup();
  });

  process.on("SIGTERM", () => {
    console.log("Received SIGTERM. Cleaning up before shutdown...");
    cleanup();
  });

  process.on("exit", () => {
    console.log("Server exiting. Cleaning up public directory...");
    cleanup();
  });

  return app;
}
