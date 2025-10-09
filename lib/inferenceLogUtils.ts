import fs from "fs/promises";
import path from "path";
import { INFERENCE_LOGS_DIR } from "./constants";
import { InferenceLog } from "./types";
import { isNodeError } from "./utils";

export async function saveInferenceLog(log: InferenceLog): Promise<void> {
  const logPath = path.join(INFERENCE_LOGS_DIR, `${log.id}.json`);

  // Security: Prevent path traversal attacks.
  const resolvedPath = path.resolve(logPath);
  const resolvedBaseDir = path.resolve(INFERENCE_LOGS_DIR);

  if (!resolvedPath.startsWith(resolvedBaseDir + path.sep)) {
    // This should not happen if IDs are generated correctly, but as a safeguard:
    console.error(`Path traversal attempt blocked for saving log id: ${log.id}`);
    throw new Error("Invalid log ID detected.");
  }

  await fs.writeFile(resolvedPath, JSON.stringify(log, null, 2));
}

export async function updateInferenceLog(
  id: string,
  updates: Partial<InferenceLog>,
): Promise<void> {
  const log = await getInferenceLog(id);
  if (!log) {
    // Or throw an error, depending on desired behavior
    console.warn(`Log with id ${id} not found for update.`);
    return;
  }

  const updatedLog = { ...log, ...updates };
  await saveInferenceLog(updatedLog);
}

export async function appendToInferenceLog(
  id: string,
  newContent: Partial<InferenceLog>,
): Promise<void> {
  const log = await getInferenceLog(id);
  if (!log) {
    console.warn(`Log with id ${id} not found for appending.`);
export function getInferenceLog(id: string) {
  if (!id) {
    return null;
  }
  try {
    const logDir = path.resolve(INFERENCE_LOG_DIR);
    const logPath = path.resolve(logDir, `${id}.json`);

    // Prevent path traversal.
    if (!logPath.startsWith(logDir + path.sep)) {
      console.error(`Path traversal attempt detected for id: ${id}`);
      return null;
    }

    const log = fs.readFileSync(logPath, "utf-8");
    return JSON.parse(log);
  } catch (e) {
    return null;
  }
}
    // Security: Prevent path traversal attacks.
    // Ensure the resolved path is within the intended log directory.
    const resolvedPath = path.resolve(logPath);
    const resolvedBaseDir = path.resolve(INFERENCE_LOGS_DIR);

    if (!resolvedPath.startsWith(resolvedBaseDir + path.sep)) {
      console.warn(`Potential path traversal attempt for id: ${id}`);
      return null;
    }

    const data = await fs.readFile(resolvedPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    // It's okay if the file doesn't exist
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    // Re-throw other errors
    throw error;
  }
}
