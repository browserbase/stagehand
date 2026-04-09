const FILE_UPLOAD_INTENT_PATTERNS = [
  /\bupload\b/i,
  /\battach\b/i,
  /\bresume\b/i,
  /\bcv\b/i,
  /\bcover letter\b/i,
  /\bfile input\b/i,
  /\bfile upload\b/i,
  /\bfile chooser\b/i,
  /\bchoose file\b/i,
  /\bselect file\b/i,
  /\bbrowse files?\b/i,
  /\bdrag-and-drop\b/i,
  /\bagent profile\b/i,
  /\bprofile photo\b/i,
];

const LOCAL_PATH_PATTERN =
  /(?:^|[\s"'`])(?:\/[^\s"'`]+|~\/[^\s"'`]+|[A-Za-z]:\\[^\s"'`]+)(?=$|[\s"'`])/;
const FILE_EXTENSION_PATTERN =
  /\.(pdf|docx?|txt|rtf|png|jpe?g|gif|webp|csv|json|zip|mp3|wav|m4a|mov|mp4)\b/i;

export const FILE_UPLOAD_GUARD_ERROR =
  "File uploads must use the upload tool. Do not click, type into, or fill file inputs with click, act, type, fillForm, or fillFormVision. If no local path is available yet, ask the user for one.";

export function getFileUploadGuardError(...texts: Array<string | undefined>) {
  const combined = texts
    .filter(
      (text): text is string =>
        typeof text === "string" && text.trim().length > 0,
    )
    .join(" ");

  if (!combined) {
    return null;
  }

  const hasFileIntent = FILE_UPLOAD_INTENT_PATTERNS.some((pattern) =>
    pattern.test(combined),
  );
  const hasLocalPath =
    LOCAL_PATH_PATTERN.test(combined) || FILE_EXTENSION_PATTERN.test(combined);

  if (!hasFileIntent && !hasLocalPath) {
    return null;
  }

  return FILE_UPLOAD_GUARD_ERROR;
}
