import Browserbase from "@browserbasehq/sdk";
import { createReadStream } from "fs";
import dotenv from "dotenv";

dotenv.config();

export async function createExtension(bb: Browserbase): Promise<string> {
  const extensionPath = process.env.EXTENSION_ZIP_PATH!;
  const extension = await bb.extensions.create({
    file: createReadStream(extensionPath),
  });
  console.log("\n\n\n");
  console.log(`Extension uploaded with ID: ${extension.id}`);
  console.log(`Load this extension into your .env file as EXTENSION_ID`);
  console.log("\n\n\n");
  return extension.id;
}

async function main() {
  const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  await createExtension(bb);
}

main();
