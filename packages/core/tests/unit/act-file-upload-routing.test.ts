import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { Action } from "../../lib/v3/types/public/methods.js";
import { StagehandInvalidArgumentError } from "../../lib/v3/types/public/sdkErrors.js";
import {
  extractVariableTokens,
  instructionMentionsVariableKey,
  looksLikeFilePath,
  resolveSetInputFilesArguments,
  selectFileUploadAction,
  shouldResolveFileUploadLocally,
} from "../../lib/v3/handlers/handlerUtils/actFileUploadRouting.js";

describe("shouldResolveFileUploadLocally", () => {
  it("detects attach instructions with file variables", () => {
    expect(
      shouldResolveFileUploadLocally("attach %resume% to the resume field", {
        resume: "/tmp/resume.pdf",
      }),
    ).toBe(true);
  });

  it("detects upload instructions that name files", () => {
    expect(
      shouldResolveFileUploadLocally("upload %resume% to the resume field", {
        resume: "/tmp/resume.pdf",
      }),
    ).toBe(true);
  });

  it("detects select/choose phrasing with file variables", () => {
    expect(
      shouldResolveFileUploadLocally("select %resume% in the resume field", {
        resume: "/tmp/resume.pdf",
      }),
    ).toBe(true);
    expect(
      shouldResolveFileUploadLocally("choose %resume% for the resume field", {
        resume: "/tmp/resume.pdf",
      }),
    ).toBe(true);
  });

  it("detects upload instructions when variables are named in the instruction", () => {
    expect(
      shouldResolveFileUploadLocally("upload resume to the resume field", {
        resume: "/tmp/resume.pdf",
      }),
    ).toBe(true);
  });

  it("detects extensionless relative paths referenced by variable tokens", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stagehand-upload-"));
    const filePath = path.join(dir, "resume");
    writeFileSync(filePath, "resume");

    expect(
      shouldResolveFileUploadLocally("upload %resume% to the resume field", {
        resume: filePath,
      }),
    ).toBe(true);
  });

  it("detects upload instructions with @ in the file path", () => {
    expect(
      shouldResolveFileUploadLocally("upload %resume% to the resume field", {
        resume: "/tmp/resume@2024.pdf",
      }),
    ).toBe(true);
  });

  it("ignores unrelated upload wording", () => {
    expect(
      shouldResolveFileUploadLocally("scroll the upload section into view"),
    ).toBe(false);
    expect(shouldResolveFileUploadLocally("attach debugger to the page")).toBe(
      false,
    );
    expect(shouldResolveFileUploadLocally("upload progress to 100%")).toBe(
      false,
    );
  });

  it("does not route file-variable instructions without upload intent", () => {
    expect(
      shouldResolveFileUploadLocally("fill in the pdf form", {
        pdf: "/tmp/form.pdf",
      }),
    ).toBe(false);
    expect(
      shouldResolveFileUploadLocally("open the resume preview", {
        resume: "/tmp/resume.pdf",
      }),
    ).toBe(false);
  });

  it("requires a referenced file variable even with upload wording", () => {
    expect(
      shouldResolveFileUploadLocally("upload the photo gallery", {
        photo: "/tmp/photo.png",
      }),
    ).toBe(false);
    expect(
      shouldResolveFileUploadLocally("upload the photo gallery", {
        resume: "/tmp/resume.pdf",
      }),
    ).toBe(false);
  });

  it("does not treat URL variables as local file uploads", () => {
    expect(
      shouldResolveFileUploadLocally("go to %url%", {
        url: "https://example.com/path",
      }),
    ).toBe(false);
    expect(
      shouldResolveFileUploadLocally("upload %url% to the form", {
        url: "https://example.com/file.pdf",
      }),
    ).toBe(false);
  });

  it("requires a resolvable file path before using the local upload path", () => {
    expect(shouldResolveFileUploadLocally("upload the document")).toBe(false);
    expect(
      shouldResolveFileUploadLocally("upload %document%", {
        document: "not-a-path",
      }),
    ).toBe(false);
  });

  it("does not match variable names as substrings of unrelated words", () => {
    expect(
      shouldResolveFileUploadLocally("upload to the archive section", {
        cv: "/tmp/resume.pdf",
      }),
    ).toBe(false);
    expect(
      shouldResolveFileUploadLocally("upload the candidate resume", {
        id: "/tmp/resume.pdf",
      }),
    ).toBe(false);
  });

  it("still matches whole-word variable names without %tokens%", () => {
    expect(
      shouldResolveFileUploadLocally("upload resume to the resume field", {
        resume: "/tmp/resume.pdf",
      }),
    ).toBe(true);
  });
});

describe("selectFileUploadAction", () => {
  const resumeAction: Action = {
    selector: "xpath=/html/body/input#resume",
    description: "resume file input",
    method: "setInputFiles",
    arguments: ["%resume%"],
  };
  const imagesAction: Action = {
    selector: "xpath=/html/body/input#images",
    description: "images file input",
    method: "setInputFiles",
    arguments: ["%images%"],
  };

  it("returns the only setInputFiles candidate", () => {
    expect(
      selectFileUploadAction([resumeAction], "upload %resume%", {
        resume: "/tmp/resume.pdf",
      }),
    ).toEqual(resumeAction);
  });

  it("prefers the candidate that matches the instruction", () => {
    expect(
      selectFileUploadAction(
        [imagesAction, resumeAction],
        "upload %resume% to the resume field",
        { resume: "/tmp/resume.pdf", images: "/tmp/a.png" },
      ),
    ).toEqual(resumeAction);
  });

  it("throws when multiple file inputs cannot be disambiguated", () => {
    expect(() =>
      selectFileUploadAction([imagesAction, resumeAction], "upload files", {
        resume: "/tmp/resume.pdf",
        images: "/tmp/a.png",
      }),
    ).toThrow(StagehandInvalidArgumentError);
  });
});

describe("resolveSetInputFilesArguments", () => {
  it("substitutes variable placeholders", () => {
    expect(
      resolveSetInputFilesArguments(
        {
          selector: "xpath=/html/body/input",
          description: "resume file input",
          method: "setInputFiles",
          arguments: ["%resume%"],
        },
        { resume: "/tmp/resume.pdf" },
      ),
    ).toEqual(["/tmp/resume.pdf"]);
  });

  it("infers a single file variable from the action description", () => {
    expect(
      resolveSetInputFilesArguments(
        {
          selector: "xpath=/html/body/input",
          description: "resume file input",
          method: "setInputFiles",
          arguments: [],
        },
        { resume: "/tmp/resume.pdf" },
      ),
    ).toEqual(["/tmp/resume.pdf"]);
  });

  it("infers a file variable from the original instruction before the generic description", () => {
    expect(
      resolveSetInputFilesArguments(
        {
          selector: "xpath=/html/body/input",
          description: "file upload input",
          method: "setInputFiles",
          arguments: [],
        },
        { resume: "/tmp/resume.pdf", avatar: "/tmp/avatar.png" },
        "upload %resume% to the resume field",
      ),
    ).toEqual(["/tmp/resume.pdf"]);
  });

  it("infers the only file variable when observe returns empty arguments", () => {
    expect(
      resolveSetInputFilesArguments(
        {
          selector: "xpath=/html/body/input",
          description: "file upload input",
          method: "setInputFiles",
          arguments: [],
        },
        { resume: "/tmp/resume.pdf" },
      ),
    ).toEqual(["/tmp/resume.pdf"]);
  });

  it("scopes multi-variable instructions to the action description", () => {
    expect(
      resolveSetInputFilesArguments(
        {
          selector: "xpath=/html/body/input#resume",
          description: "resume file input",
          method: "setInputFiles",
          arguments: [],
        },
        { resume: "/tmp/resume.pdf", cover: "/tmp/cover.pdf" },
        "upload %resume% and %cover%",
      ),
    ).toEqual(["/tmp/resume.pdf"]);
  });

  it("does not infer when multiple file variables are present but none are mentioned", () => {
    expect(() =>
      resolveSetInputFilesArguments(
        {
          selector: "xpath=/html/body/input",
          description: "file input",
          method: "setInputFiles",
          arguments: [],
        },
        { resume: "/tmp/resume.pdf", avatar: "/tmp/avatar.png" },
      ),
    ).toThrow(/at least one non-empty file path/i);
  });

  it("rejects unresolved variable placeholders", () => {
    expect(() =>
      resolveSetInputFilesArguments({
        selector: "xpath=/html/body/input",
        description: "resume file input",
        method: "setInputFiles",
        arguments: ["%resume%"],
      }),
    ).toThrow(/variable placeholder/i);
  });
});

describe("file upload helpers", () => {
  it("extracts variable tokens", () => {
    expect(extractVariableTokens("upload %resume% and %cover%")).toEqual([
      "resume",
      "cover",
    ]);
  });

  it("matches variable keys by token or whole word only", () => {
    expect(instructionMentionsVariableKey("upload %resume%", "resume")).toBe(
      true,
    );
    expect(
      instructionMentionsVariableKey("upload resume to the field", "resume"),
    ).toBe(true);
    expect(instructionMentionsVariableKey("upload to the archive", "cv")).toBe(
      false,
    );
    expect(
      instructionMentionsVariableKey("upload candidate resume", "id"),
    ).toBe(false);
  });

  it("recognizes likely file paths", () => {
    expect(looksLikeFilePath("/tmp/resume.pdf")).toBe(true);
    expect(looksLikeFilePath("/tmp/resume")).toBe(true);
    expect(looksLikeFilePath("resume.pdf")).toBe(true);
    expect(looksLikeFilePath("fixtures/resume.pdf")).toBe(true);
    expect(looksLikeFilePath("https://example.com/resume.pdf")).toBe(false);
    expect(looksLikeFilePath("2024/01/15")).toBe(false);
    expect(looksLikeFilePath("secret123")).toBe(false);
    expect(looksLikeFilePath("user@example.com")).toBe(false);
    expect(looksLikeFilePath("/tmp/resume@2024.pdf")).toBe(true);
    expect(looksLikeFilePath("resume@2024.pdf")).toBe(true);
    expect(looksLikeFilePath("fixtures/resume@2024.pdf")).toBe(true);
    expect(looksLikeFilePath("example.com")).toBe(false);
    expect(looksLikeFilePath("v1.2.3")).toBe(false);
  });

  it("recognizes extensionless relative paths that exist on disk", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stagehand-upload-"));
    const relativeDir = path.basename(dir);
    const fileName = "resume";
    writeFileSync(path.join(dir, fileName), "resume");

    expect(
      looksLikeFilePath(path.join(relativeDir, fileName), {
        baseDir: path.dirname(dir),
      }),
    ).toBe(true);
    expect(looksLikeFilePath("missing/fixtures/resume")).toBe(false);
  });
});
