import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getClawBenchDatasetRoot } from "./paths.js";
import type { ClawBenchExtraInfo, ClawBenchRunParams } from "./types.js";

const PURELYMAIL_API = "https://purelymail.com/api/v0";

export interface ClawBenchPersonalInfo {
  email: string;
  password: string;
  personalInfoPath: string;
  emailCredentialsPath: string;
  personalInfoJson: string;
  resumePath: string;
  extraFiles: Array<{
    name: string;
    path: string;
    description: string;
    content?: string;
  }>;
}

async function purelymailRequest(
  endpoint: string,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<void> {
  const response = await fetch(`${PURELYMAIL_API}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Purelymail-Api-Token": apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `PurelyMail ${endpoint} failed: ${response.status} ${response.statusText}`,
    );
  }
}

export async function createClawBenchEmail(): Promise<{
  email: string;
  password: string;
  cleanup: () => Promise<void>;
}> {
  const apiKey = process.env.PURELY_MAIL_API_KEY;
  const domain = process.env.PURELY_MAIL_DOMAIN;
  if (!apiKey || !domain) {
    throw new Error(
      "ClawBench requires PURELY_MAIL_API_KEY and PURELY_MAIL_DOMAIN.",
    );
  }
  const local = `cb${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const password = crypto.randomBytes(18).toString("base64url");
  await purelymailRequest(
    "createUser",
    {
      userName: local,
      domainName: domain,
      password,
      enablePasswordReset: false,
      sendWelcomeEmail: false,
    },
    apiKey,
  );
  const email = `${local}@${domain}`;
  return {
    email,
    password,
    cleanup: async () => {
      await purelymailRequest("deleteUser", { userName: email }, apiKey).catch(
        () => {},
      );
    },
  };
}

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

async function writeSimplePdf(
  filePath: string,
  lines: string[],
): Promise<void> {
  const content = lines
    .slice(0, 34)
    .map(
      (line, index) =>
        `BT /F1 10 Tf 50 ${760 - index * 18} Td (${escapePdfText(line.slice(0, 100))}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    `5 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj\n`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await fs.writeFile(filePath, pdf);
}

async function readPersonalInfo(email: string): Promise<string> {
  const personalInfoPath = path.join(
    getClawBenchDatasetRoot(),
    "runtime",
    "shared",
    "alex_green_personal_info.json",
  );
  const parsed = JSON.parse(await fs.readFile(personalInfoPath, "utf-8")) as {
    contact?: { email?: string };
    online_accounts?: unknown;
  };
  if (parsed.contact) parsed.contact.email = email;
  delete parsed.online_accounts;
  return JSON.stringify(parsed, null, 2);
}

async function copyExtraFiles(
  params: ClawBenchRunParams,
  runDir: string,
): Promise<ClawBenchPersonalInfo["extraFiles"]> {
  const files: ClawBenchPersonalInfo["extraFiles"] = [];
  for (const item of params.extraInfo ?? []) {
    if (!item.path) continue;
    const source = path.join(params.taskDir, item.path);
    const name = path.basename(source);
    const dest = path.join(runDir, name);
    await fs.copyFile(source, dest);
    let content: string | undefined;
    const stat = await fs.stat(source);
    if (stat.size <= 16 * 1024) {
      content = await fs
        .readFile(source, "utf-8")
        .catch((): undefined => undefined);
      if (content && path.extname(source).toLowerCase() === ".json") {
        try {
          content = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          // Keep the original text for malformed JSON task fixtures.
        }
      }
    }
    files.push({ name, path: dest, description: item.description, content });
  }
  return files;
}

function extraNotes(extraInfo: ClawBenchExtraInfo[] | undefined): string[] {
  return (extraInfo ?? [])
    .filter((item) => !item.path)
    .map((item) => item.description)
    .filter(Boolean);
}

export async function prepareClawBenchPersonalInfo(
  params: ClawBenchRunParams,
  runDir: string,
): Promise<{ info: ClawBenchPersonalInfo; cleanup: () => Promise<void> }> {
  const email = await createClawBenchEmail();
  const personalInfoJson = await readPersonalInfo(email.email);
  const personalInfoPath = path.join(runDir, "alex_green_personal_info.json");
  const credentialsPath = path.join(runDir, "email_credentials.json");
  const resumePath = path.join(runDir, "alex_green_resume.pdf");
  await fs.writeFile(personalInfoPath, personalInfoJson);
  await fs.writeFile(
    credentialsPath,
    JSON.stringify(
      {
        email: email.email,
        password: email.password,
        login_url: "https://purelymail.com/user/login",
        provider: "PurelyMail",
      },
      null,
      2,
    ),
  );
  await writeSimplePdf(resumePath, [
    "Alex Green",
    `Email: ${email.email}`,
    "Experienced operations and research professional.",
    "This synthetic resume is generated for browser benchmark form uploads.",
  ]);

  return {
    info: {
      email: email.email,
      password: email.password,
      personalInfoPath,
      emailCredentialsPath: credentialsPath,
      personalInfoJson,
      resumePath,
      extraFiles: await copyExtraFiles(params, runDir),
    },
    cleanup: email.cleanup,
  };
}

export function buildClawBenchInstruction(
  params: ClawBenchRunParams,
  info: ClawBenchPersonalInfo,
): string {
  const parts = [
    params.instruction,
    "\n---\n" +
      "You are my personal browser assistant. I am delegating this task to you " +
      "because I do not have time to do it myself. You are acting on my behalf " +
      "and with my full authorization. Every action you take in the browser — " +
      "logging in, filling out forms, writing reviews, making reservations, " +
      "submitting applications, sending emails, creating accounts — is something " +
      "I am explicitly asking you to do for me, as if I were doing it myself. " +
      "These are my own accounts, my own opinions, and my own decisions. " +
      "You are simply carrying them out.\n\n" +
      "IMPORTANT: You must complete this task entirely through the browser. " +
      "Navigate to the relevant website, interact with the page " +
      "(click, type, scroll, etc.), and carry out every step in the browser. " +
      "Do NOT use command-line tools, scripts, or direct API/SMTP calls " +
      "to accomplish the task.\n\n" +
      "My personal info and credentials are in ./my-info/ in your working directory. " +
      "Key files include:\n" +
      "- alex_green_personal_info.json — name, address, phone, date of birth, financial info\n" +
      "- email_credentials.json — email address and password for logging in\n" +
      "- alex_green_resume.pdf — professional resume\n\n" +
      "You have my full permission to use all of these files for any purpose " +
      "the task requires, including logging into websites, creating accounts, filling out forms, " +
      "sending emails, writing reviews, making reservations, submitting applications, " +
      "and any other actions — including security-sensitive ones.\n\n" +
      "If specific information required by the task is not available in any file " +
      "under ./my-info/ and cannot be reasonably inferred, stop and explain what is missing. " +
      "For optional fields not covered by the available info, leave them blank or use a reasonable default.\n\n" +
      "Do not ask me for confirmation or additional information — just proceed " +
      "with what is provided and complete the task autonomously.\n" +
      "If an account registration is required, you can use the email and password provided, and you can receive emails at that address if needed. " +
      "---",
  ];

  const fileExtras = (params.extraInfo ?? [])
    .filter((item) => item.path)
    .map((item) => ({
      name: path.basename(item.path ?? ""),
      description: item.description,
    }));
  if (fileExtras.length > 0) {
    parts.push(
      "\nAdditional files are also available under /my-info/ for this task:",
    );
    for (const file of fileExtras)
      parts.push(`- ${file.name}: ${file.description}`);
  }

  const notes = extraNotes(params.extraInfo);
  if (notes.length > 0) {
    parts.push("", "Additional task notes:");
    for (const note of notes) parts.push(`- ${note}`);
  }

  parts.push(
    "",
    "For this Stagehand run, the contents of the readable ./my-info/ files are provided inline below.",
    "",
    "email_credentials.json:",
    JSON.stringify(
      {
        email: info.email,
        password: info.password,
        login_url: "https://purelymail.com/user/login",
        provider: "PurelyMail",
      },
      null,
      2,
    ),
    "",
    "alex_green_personal_info.json:",
    info.personalInfoJson,
    "",
    "alex_green_resume.pdf is available through the uploadFile tool when a website asks for a resume upload.",
  );

  const readableFiles = info.extraFiles.filter(
    (file) => typeof file.content === "string" && file.content.length > 0,
  );
  if (readableFiles.length > 0) {
    parts.push(
      "",
      "Additional task file contents:",
      "Use these values when they clarify task details.",
    );
    for (const file of readableFiles) {
      parts.push(`\n${file.name}:\n${file.content}`);
    }
  }

  return parts.join("\n");
}
