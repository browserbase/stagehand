import { Aes256Gcm, CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import fc from "fast-check";
import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  daemonRequestTimeoutMs,
  runDriverCommandViaDaemon,
} from "../src/lib/driver/daemon/client.js";
import {
  collectForwardedEnv,
  forwardedEnvSignature,
  type ForwardedEnv,
} from "../src/lib/driver/daemon/forwarded-env.js";
import {
  getLockPath,
  getNetworkDir,
  getPidPath,
  getSocketPath,
  runtimeDir,
  sanitizeSessionName,
} from "../src/lib/driver/daemon/paths.js";
import {
  parseRequest,
  ResponseSchema,
  serializeResponse,
  type DriverRequest,
  type DriverResponse,
} from "../src/lib/driver/daemon/protocol.js";
import { runDriverDaemon } from "../src/lib/driver/daemon/server.js";
import { DRIVER_COMMAND_NAMES } from "../src/lib/driver/commands/types.js";
import { CommandFailure } from "../src/lib/errors.js";
import {
  attachFunctionSecret,
  deleteSecret,
  detachFunctionSecret,
  getSecret,
  listFunctionSecrets,
  listSecrets,
} from "../src/lib/secrets/api.js";
import { toListSecretsOptions } from "../src/lib/secrets/flags.js";
import { readSecretValue } from "../src/lib/secrets/input.js";
import { sealSecret } from "../src/lib/secrets/seal.js";
import { describePosix } from "./helpers/platform.js";

const UNIX_SUN_PATH_MAX_BYTES = 103;
const SEED_BASE = 20261125;

function createHpkeSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

async function openSealedSecret(
  suite: CipherSuite,
  privateKey: CryptoKey,
  sealedBase64: string,
): Promise<Uint8Array> {
  const blob = Buffer.from(sealedBase64, "base64");
  const enc = new Uint8Array(blob.subarray(0, 32)).buffer;
  const ciphertext = new Uint8Array(blob.subarray(32)).buffer;
  const recipient = await suite.createRecipientContext({ recipientKey: privateKey, enc });
  return new Uint8Array(await recipient.open(ciphertext));
}

function splitBufferAt(buf: Buffer, cutPoints: readonly number[]): Buffer[] {
  if (buf.length === 0) return [];
  const sorted = [...new Set(cutPoints.map((c) => Math.max(1, Math.min(buf.length - 1, c))))].sort(
    (a, b) => a - b,
  );
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const cut of sorted) {
    if (cut > offset && cut < buf.length) {
      chunks.push(buf.subarray(offset, cut));
      offset = cut;
    }
  }
  chunks.push(buf.subarray(offset));
  return chunks;
}

const adversarialStringArb = fc.oneof(
  fc.string({ maxLength: 120 }),
  fc.string({ unit: "binary", maxLength: 80 }),
  fc.constantFrom(
    "",
    " ",
    "\t\r\n",
    "\0",
    "a=b=c",
    "KEY=VAL\nOTHER=2",
    "\"quoted\"'single'\\escaped",
    '{"key":"val\u2028\u2029"}',
    "../secret/../../etc/passwd",
    "日本語🔑✓🚀",
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ),
);

const sensitiveEnvKeyArb = fc.constantFrom(
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "STRIPE_SECRET_KEY",
  "DATABASE_URL",
  "NPM_TOKEN",
  "BROWSERBASE_PROJECT_ID",
  "BROWSE_DAEMON_DIR",
  "BROWSE_SESSION",
  "PATH",
  "HOME",
  "SSH_AUTH_SOCK",
);

const validDriverRequestArb: fc.Arbitrary<DriverRequest> = fc.oneof(
  fc.record({
    type: fc.constant("open" as const),
    id: fc.string({ minLength: 1, maxLength: 40 }),
    url: fc.string({ minLength: 1, maxLength: 120 }),
    timeoutMs: fc.option(fc.integer({ min: 1, max: 120_000 }), { nil: undefined }),
    waitUntil: fc.option(
      fc.constantFrom("load" as const, "domcontentloaded" as const, "networkidle" as const),
      { nil: undefined },
    ),
    forwardedEnv: fc.option(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 40 }), {
        maxKeys: 3,
      }),
      { nil: undefined },
    ),
  }),
  fc.record({
    type: fc.constant("command" as const),
    id: fc.string({ minLength: 1, maxLength: 40 }),
    command: fc.constantFrom(...DRIVER_COMMAND_NAMES),
    params: fc.option(fc.jsonValue(), { nil: undefined }),
    forwardedEnv: fc.option(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 40 }), {
        maxKeys: 3,
      }),
      { nil: undefined },
    ),
  }),
  fc.record({
    type: fc.constant("status" as const),
    id: fc.string({ minLength: 1, maxLength: 40 }),
  }),
  fc.record({
    type: fc.constant("stop" as const),
    id: fc.string({ minLength: 1, maxLength: 40 }),
  }),
);

const validDriverResponseArb: fc.Arbitrary<DriverResponse> = fc.oneof(
  fc.record({
    type: fc.constant("success" as const),
    id: fc.string({ maxLength: 40 }),
    data: fc.jsonValue(),
  }),
  fc.record({
    type: fc.constant("error" as const),
    id: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
    error: fc.string({ maxLength: 120 }),
    code: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
    httpStatus: fc.option(fc.integer({ min: 100, max: 599 }), { nil: undefined }),
  }),
);

describe("secrets property verification", () => {
  const suite = createHpkeSuite();
  let pair: CryptoKeyPair;
  let validPublicKey: string;

  beforeAll(async () => {
    pair = await suite.kem.deriveKeyPair(new Uint8Array(32).fill(7));
    validPublicKey = Buffer.from(await suite.kem.serializePublicKey(pair.publicKey)).toString(
      "base64",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("round-trips arbitrary byte payloads and subarray views through HPKE sealing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 4096 }),
        fc.integer({ min: 0, max: 32 }),
        fc.integer({ min: 0, max: 32 }),
        async (payload, prefixLen, suffixLen) => {
          const padded = new Uint8Array(prefixLen + payload.length + suffixLen);
          padded.fill(0xaa);
          padded.set(payload, prefixLen);
          const view = padded.subarray(prefixLen, prefixLen + payload.length);

          const sealed = await sealSecret(validPublicKey, view);
          const decoded = Buffer.from(sealed, "base64");
          expect(decoded.toString("base64")).toBe(sealed);
          expect(decoded.length).toBe(32 + payload.length + 16);

          const recovered = await openSealedSecret(suite, pair.privateKey, sealed);
          expect(Buffer.compare(Buffer.from(recovered), Buffer.from(payload))).toBe(0);
        },
      ),
      { numRuns: 30, seed: SEED_BASE + 1 },
    );
  });

  it("never leaks plaintext canaries and randomizes ciphertexts per seal", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 16, maxLength: 256 }).filter((s) => Buffer.byteLength(s) >= 16),
        async (canary) => {
          const bytes = Buffer.from(canary, "utf8");
          const sealedA = await sealSecret(validPublicKey, bytes);
          const sealedB = await sealSecret(validPublicKey, bytes);

          expect(sealedA).not.toBe(sealedB);
          expect(sealedA).not.toContain(canary);
          expect(sealedA).not.toContain(bytes.toString("base64"));
          expect(Buffer.from(sealedA, "base64").includes(bytes)).toBe(false);

          const recovered = await openSealedSecret(suite, pair.privateKey, sealedA);
          expect(Buffer.from(recovered).toString("utf8")).toBe(canary);
        },
      ),
      { numRuns: 25, seed: SEED_BASE + 2 },
    );
  });

  it("rejects malformed or non-canonical public keys without leaking secret bytes", async () => {
    const invalidKeyArb: fc.Arbitrary<unknown> = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.integer(),
      fc.boolean(),
      fc.object(),
      fc
        .uint8Array({ minLength: 0, maxLength: 64 })
        .filter((b) => b.length !== 32)
        .map((b) => Buffer.from(b).toString("base64")),
      fc.constant(` ${validPublicKey}`),
      fc.constant(`${validPublicKey} `),
      fc.constant(`${validPublicKey}\n`),
      fc.constant(validPublicKey.replace(/=+$/, "")),
      fc.constant(`-${validPublicKey.slice(1)}`),
      fc.constant(`_${validPublicKey.slice(1)}`),
      fc.constant(Buffer.alloc(32, 0).toString("base64")),
      fc.string({ maxLength: 64 }).filter((s) => {
        const buf = Buffer.from(s, "base64");
        return buf.length !== 32 || buf.toString("base64") !== s;
      }),
    );

    const canary = "SUPER_SECRET_CANARY_VALUE_9f8e7d6c";
    await fc.assert(
      fc.asyncProperty(invalidKeyArb, async (badKey) => {
        let caught: unknown;
        try {
          await sealSecret(badKey, Buffer.from(canary, "utf8"));
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(CommandFailure);
        expect((caught as Error).message).not.toContain(canary);
      }),
      { numRuns: 40, seed: SEED_BASE + 3 },
    );
  });

  it("preserves exact UTF-8 env secret values and rejects unset prototype keys", async () => {
    const validEnvNameArb = fc
      .stringMatching(/^[A-Z][A-Z0-9_]{2,24}$/)
      .map((name) => `BROWSE_PROP_SECRET_${name}`);
    const envValueArb = fc
      .oneof(adversarialStringArb, fc.string({ maxLength: 256 }))
      .map((s) => s.replaceAll("\0", ""));

    await fc.assert(
      fc.asyncProperty(validEnvNameArb, envValueArb, async (envName, secretVal) => {
        vi.stubEnv(envName, secretVal);
        try {
          const bytes = await readSecretValue({ env: envName });
          expect(Buffer.from(bytes).toString("utf8")).toBe(secretVal);
        } finally {
          vi.unstubAllEnvs();
        }
      }),
      { numRuns: 50, seed: SEED_BASE + 4 },
    );

    for (const protoKey of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      await expect(readSecretValue({ env: protoKey })).rejects.toBeInstanceOf(CommandFailure);
    }
  });

  it("reconstructs arbitrary binary stdin streams across random chunk splits losslessly", async () => {
    const originalStdin = process.stdin;
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 0, maxLength: 512 }),
          fc.array(fc.integer({ min: 0, max: 512 }), { maxLength: 20 }),
          async (payload, cutPoints) => {
            const buf = Buffer.from(payload);
            const chunks = splitBufferAt(buf, cutPoints);
            const fakeStdin = Readable.from(chunks);
            Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
            Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });

            const result = await readSecretValue({ stdin: true });
            expect(Buffer.compare(Buffer.from(result), buf)).toBe(0);
          },
        ),
        { numRuns: 50, seed: SEED_BASE + 5 },
      );
    } finally {
      Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    }
  });

  it("maps listSecretsFlags without loss or mutation", () => {
    fc.assert(
      fc.property(
        fc.record({
          limit: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
          cursor: fc.option(adversarialStringArb, { nil: undefined }),
          "start-at": fc.option(adversarialStringArb, { nil: undefined }),
          "end-at": fc.option(adversarialStringArb, { nil: undefined }),
        }),
        (flags) => {
          expect(toListSecretsOptions(flags)).toEqual({
            limit: flags.limit,
            cursor: flags.cursor,
            startAt: flags["start-at"],
            endAt: flags["end-at"],
          });
        },
      ),
      { numRuns: 50, seed: SEED_BASE + 6 },
    );
  });

  it("prevents URL path traversal for adversarial secret and function IDs", async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seenUrls.push(url);
      return new Response(
        JSON.stringify({ id: "s1", secretKey: "K", data: [], limit: 20, nextCursor: null }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const idArb = fc.oneof(
      fc.constantFrom("", ".", "..", "%2e%2e", "../secrets/victim", "a/b?c#d", "\ud800", "abc"),
      fc.string({ maxLength: 40 }),
    );

    try {
      await fc.assert(
        fc.asyncProperty(idArb, idArb, async (functionId, secretId) => {
          seenUrls.length = 0;
          const opts = { apiKey: "test-key", baseUrl: "https://api.browserbase.com" };

          const runChecked = async (
            fn: () => Promise<unknown>,
            expectedPrefix: string,
            expectedSegments: number,
          ) => {
            try {
              await fn();
              const rawUrl = seenUrls.at(-1)!;
              const parsed = new URL(rawUrl);
              expect(parsed.pathname.startsWith(expectedPrefix)).toBe(true);
              const segments = parsed.pathname.split("/").filter(Boolean);
              expect(segments.length).toBe(expectedSegments);
            } catch (error) {
              expect(error).toBeInstanceOf(CommandFailure);
            }
          };

          await runChecked(() => getSecret(opts, secretId), "/v1/secrets/", 3);
          await runChecked(() => deleteSecret(opts, secretId), "/v1/secrets/", 3);
          await runChecked(
            () => detachFunctionSecret(opts, functionId, secretId),
            "/v1/functions/",
            5,
          );
          await runChecked(
            () => attachFunctionSecret(opts, functionId, secretId),
            "/v1/functions/",
            4,
          );
          await runChecked(() => listFunctionSecrets(opts, functionId, {}), "/v1/functions/", 4);
        }),
        { numRuns: 60, seed: SEED_BASE + 7 },
      );

      seenUrls.length = 0;
      await listSecrets(
        { apiKey: "test-key", baseUrl: "https://api.browserbase.com" },
        {
          limit: 10,
          cursor: "a&b=c",
        },
      );
      const parsed = new URL(seenUrls[0]!);
      expect(parsed.pathname).toBe("/v1/secrets");
      expect(parsed.searchParams.get("cursor")).toBe("a&b=c");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("daemon protocol, paths, and forwarded-env property verification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("round-trips valid requests and responses through JSONL protocol serialization", () => {
    fc.assert(
      fc.property(validDriverRequestArb, (request) => {
        const serialized = JSON.stringify(request);
        expect(serialized).not.toContain("\n");
        const parsed = parseRequest(serialized);
        expect(parsed).toEqual(JSON.parse(serialized));
        const timeout = daemonRequestTimeoutMs(parsed);
        expect(Number.isFinite(timeout)).toBe(true);
        expect(timeout).toBeGreaterThan(0);
        expect(timeout).toBeLessThanOrEqual(2_147_483_647);
      }),
      { numRuns: 100, seed: SEED_BASE + 10 },
    );

    fc.assert(
      fc.property(validDriverResponseArb, (response) => {
        const line = serializeResponse(response);
        expect(line.endsWith("\n")).toBe(true);
        const body = line.slice(0, -1);
        expect(body).not.toContain("\n");
        const parsed = ResponseSchema.parse(JSON.parse(body));
        expect(parsed).toEqual(JSON.parse(JSON.stringify(response)));
      }),
      { numRuns: 100, seed: SEED_BASE + 11 },
    );
  });

  it("rejects arbitrary malformed protocol lines without crashing", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 120 }),
          fc.jsonValue().map((v) => JSON.stringify(v)),
        ),
        (line) => {
          try {
            const parsed = parseRequest(line);
            expect(["open", "command", "status", "stop"]).toContain(parsed.type);
            expect(parsed.id.length).toBeGreaterThan(0);
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
        },
      ),
      { numRuns: 150, seed: SEED_BASE + 12 },
    );
  });

  it("sanitizes adversarial session names without path traversal or UNIX socket overflow", () => {
    const adversarialSessionArb = fc.oneof(
      fc.string({ maxLength: 400 }),
      fc.string({ minLength: 50, maxLength: 300 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, "a")),
      fc.constantFrom(
        "",
        ".",
        "..",
        "...",
        "../escape",
        "../../etc/passwd",
        "a/b/c",
        "a\\b\\c",
        "a\0b",
        "----",
        "....",
        "日本語/セッション",
        "a".repeat(200),
        `../${"x".repeat(200)}`,
      ),
    );

    vi.stubEnv("BROWSE_DAEMON_DIR", "");
    vi.unstubAllEnvs();
    const prev = process.env.BROWSE_DAEMON_DIR;
    delete process.env.BROWSE_DAEMON_DIR;

    try {
      const baseDir = runtimeDir();
      fc.assert(
        fc.property(adversarialSessionArb, (session) => {
          const safe = sanitizeSessionName(session);
          expect(safe.length).toBeGreaterThan(0);
          expect(safe).toMatch(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/);
          expect(safe).not.toBe(".");
          expect(safe).not.toBe("..");
          expect(safe).not.toContain("/");
          expect(safe).not.toContain("\\");
          expect(safe).not.toContain("\0");

          if (process.platform !== "win32") {
            for (const p of [
              getSocketPath(session),
              getPidPath(session),
              getLockPath(session),
              getNetworkDir(session),
            ]) {
              expect(path.dirname(p)).toBe(baseDir);
              const rel = path.relative(baseDir, p);
              expect(rel).not.toContain(path.sep);
              expect(rel.startsWith("..")).toBe(false);
            }
            expect(Buffer.byteLength(getSocketPath(session), "utf8")).toBeLessThanOrEqual(
              UNIX_SUN_PATH_MAX_BYTES,
            );
          }
        }),
        { numRuns: 200, seed: SEED_BASE + 13 },
      );

      expect(sanitizeSessionName(`${"a".repeat(120)}1`)).not.toBe(
        sanitizeSessionName(`${"a".repeat(120)}2`),
      );
    } finally {
      if (prev !== undefined) process.env.BROWSE_DAEMON_DIR = prev;
    }
  });

  it("enforces strict allowlist isolation in collectForwardedEnv", async () => {
    const envArb = fc
      .dictionary(
        fc.oneof(sensitiveEnvKeyArb, fc.string({ minLength: 1, maxLength: 24 })),
        fc.string({ maxLength: 64 }),
        { maxKeys: 12 },
      )
      .chain((base) =>
        fc.option(fc.string({ maxLength: 64 }), { nil: undefined }).map((apiKey) => ({
          ...base,
          ...(apiKey !== undefined ? { BROWSERBASE_API_KEY: apiKey } : {}),
        })),
      );

    await fc.assert(
      fc.asyncProperty(envArb, async (env) => {
        const forwarded = await collectForwardedEnv(env);
        const expectedApiKey = Object.prototype.hasOwnProperty.call(env, "BROWSERBASE_API_KEY")
          ? env.BROWSERBASE_API_KEY
          : undefined;
        if (typeof expectedApiKey === "string" && expectedApiKey.length > 0) {
          expect(forwarded).toEqual({ BROWSERBASE_API_KEY: expectedApiKey });
          expect(Object.keys(forwarded ?? {})).toEqual(["BROWSERBASE_API_KEY"]);
        } else {
          expect(forwarded).toBeUndefined();
        }
      }),
      { numRuns: 80, seed: SEED_BASE + 14 },
    );

    const inheritedEnv = Object.create({
      BROWSERBASE_API_KEY: "inherited-leak",
    }) as NodeJS.ProcessEnv;
    await expect(collectForwardedEnv(inheritedEnv)).resolves.toBeUndefined();
  });

  it("produces canonical, secret-free, collision-free signatures in forwardedEnvSignature", () => {
    const entryArb = fc.tuple(
      fc.string({ minLength: 1, maxLength: 16 }),
      fc.string({ minLength: 1, maxLength: 24 }),
    );

    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 6 }), (entries) => {
        const forwardMap: ForwardedEnv = Object.create(null) as ForwardedEnv;
        const reversedMap: ForwardedEnv = Object.create(null) as ForwardedEnv;
        for (const [k, v] of entries) forwardMap[k] = v;
        for (const [k] of [...entries].reverse()) {
          if (!Object.prototype.hasOwnProperty.call(reversedMap, k)) {
            reversedMap[k] = forwardMap[k]!;
          }
        }
        const sigA = forwardedEnvSignature(forwardMap);
        const sigB = forwardedEnvSignature(reversedMap);
        expect(sigA).toMatch(/^[a-f0-9]{64}$/);
        expect(sigA).toBe(sigB);
        for (const v of Object.values(forwardMap)) {
          if (v.length >= 12) expect(sigA).not.toContain(v);
        }
      }),
      { numRuns: 100, seed: SEED_BASE + 15 },
    );

    fc.assert(
      fc.property(
        fc.dictionary(
          fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.constantFrom("a", "b", "a\0b")),
          fc.oneof(
            fc.string({ minLength: 1, maxLength: 16 }),
            fc.constantFrom("b\0c\0d", "b", "d"),
          ),
          { minKeys: 1, maxKeys: 4 },
        ),
        fc.dictionary(
          fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.constantFrom("a", "c", "a\0b")),
          fc.oneof(
            fc.string({ minLength: 1, maxLength: 16 }),
            fc.constantFrom("b\0c\0d", "b", "d"),
          ),
          { minKeys: 1, maxKeys: 4 },
        ),
        (mapA, mapB) => {
          const norm = (m: Record<string, string>) =>
            Object.entries(m)
              .filter(([, v]) => v.length > 0)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
          const same = JSON.stringify(norm(mapA)) === JSON.stringify(norm(mapB));
          if (same) {
            expect(forwardedEnvSignature(mapA)).toBe(forwardedEnvSignature(mapB));
          } else {
            expect(forwardedEnvSignature(mapA)).not.toBe(forwardedEnvSignature(mapB));
          }
        },
      ),
      { numRuns: 150, seed: SEED_BASE + 16 },
    );

    expect(forwardedEnvSignature({ a: "b\0c\0d" })).not.toBe(
      forwardedEnvSignature({ a: "b", c: "d" }),
    );
  });
});

describePosix("daemon IPC socket framing property verification", () => {
  let daemonDir: string;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (daemonDir) {
      await fs.rm(daemonDir, { recursive: true, force: true });
      daemonDir = "";
    }
  });

  it("decodes arbitrary UTF-8 responses split across arbitrary byte boundaries and trailing frames", async () => {
    daemonDir = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "browse-ipc-")));
    vi.stubEnv("BROWSE_DAEMON_DIR", daemonDir);
    const session = "a".repeat(120);

    let activeHandler: ((socket: net.Socket, requestId: string) => void) | undefined;
    const server = net.createServer((socket) => {
      let reqBuf = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        reqBuf += chunk;
        const nl = reqBuf.indexOf("\n");
        if (nl === -1) return;
        const req = JSON.parse(reqBuf.slice(0, nl)) as { id: string };
        activeHandler?.(socket, req.id);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(getSocketPath(session), resolve);
    });

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            text: fc.oneof(
              fc.string({ maxLength: 100 }),
              fc.constantFrom(
                "日本語 ✓ 🚀",
                "line1\nline2",
                "sep\u2028\u2029end",
                '"quotes"\\slash',
              ),
            ),
            count: fc.integer({ min: -1000, max: 1000 }),
          }),
          fc.array(fc.integer({ min: 1, max: 300 }), { minLength: 1, maxLength: 12 }),
          fc.boolean(),
          async (payload, cutPoints, appendTrailingFrame) => {
            activeHandler = (socket, requestId) => {
              const firstLine = `${JSON.stringify({ type: "success", id: requestId, data: payload })}\n`;
              const trailing = appendTrailingFrame ? '{"type":"error","error":"ignored"}\n' : "";
              const raw = Buffer.from(firstLine + trailing, "utf8");
              const chunks = splitBufferAt(raw, cutPoints);
              socket.setNoDelay(true);
              let idx = 0;
              const writeNext = () => {
                if (idx >= chunks.length) {
                  socket.end();
                  return;
                }
                socket.write(chunks[idx++]!, () => {
                  setImmediate(writeNext);
                });
              };
              writeNext();
            };

            const result = await runDriverCommandViaDaemon(session, "snapshot");
            expect(result).toEqual(payload);
          },
        ),
        { numRuns: 20, seed: SEED_BASE + 20 },
      );

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("", '{"type":', "not-json\n", '{"type":"unknown"}\n', "{}\n"),
          async (badReply) => {
            activeHandler = (socket) => {
              socket.end(badReply);
            };
            await expect(runDriverCommandViaDaemon(session, "snapshot")).rejects.toThrow();
          },
        ),
        { numRuns: 5, seed: SEED_BASE + 21 },
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("recovers cleanly from chunked, malformed, and truncated client frames in daemon server", async () => {
    daemonDir = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "browse-srv-")));
    vi.stubEnv("BROWSE_DAEMON_DIR", daemonDir);
    const session = "srv-prop";
    const daemonPromise = runDriverDaemon({
      session,
      target: { kind: "managed-local", headless: true },
    });

    const socketPath = getSocketPath(session);
    const start = Date.now();
    while (Date.now() - start < 2_000) {
      const ok = await new Promise<boolean>((resolve) => {
        const s = net.createConnection(socketPath);
        s.once("connect", () => {
          s.destroy();
          resolve(true);
        });
        s.once("error", () => resolve(false));
      });
      if (ok) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const sendRawChunked = (
      raw: Buffer,
      cutPoints: readonly number[],
      halfCloseAfterWrite = false,
    ): Promise<string> =>
      new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        socket.setEncoding("utf8");
        let reply = "";
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error("Timed out waiting for daemon reply"));
        }, 2_000);
        socket.on("data", (chunk) => {
          reply += chunk;
        });
        socket.once("end", () => {
          clearTimeout(timer);
          resolve(reply);
        });
        socket.once("close", () => {
          clearTimeout(timer);
          resolve(reply);
        });
        socket.once("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        socket.once("connect", () => {
          const chunks = splitBufferAt(raw, cutPoints);
          let idx = 0;
          const next = () => {
            if (idx >= chunks.length) {
              if (halfCloseAfterWrite) socket.end();
              return;
            }
            socket.write(chunks[idx++]!, () => {
              setImmediate(next);
            });
          };
          next();
        });
      });

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constantFrom(
              "\n",
              "{not-json\n",
              '{"type":"open"}\n',
              '{"type":"status","id":""}\n',
              '{"type":"bad","id":"1"}\n',
              '{"type":"status","id":"日本語-✓"}\n{"type":"stop","id":"ignored"}\n',
            ),
            fc
              .string({ minLength: 1, maxLength: 40 })
              .map((id) => `${JSON.stringify({ type: "status", id })}\n`),
          ),
          fc.array(fc.integer({ min: 1, max: 120 }), { minLength: 1, maxLength: 10 }),
          async (frame, cutPoints) => {
            const reply = await sendRawChunked(Buffer.from(frame, "utf8"), cutPoints);
            expect(reply.endsWith("\n")).toBe(true);
            const parsed = ResponseSchema.parse(JSON.parse(reply.trimEnd()));
            expect(["success", "error"]).toContain(parsed.type);
          },
        ),
        { numRuns: 25, seed: SEED_BASE + 22 },
      );

      await sendRawChunked(
        Buffer.from('{"type":"status","id":"partial-no-nl"}', "utf8"),
        [1, 5, 12],
        true,
      );

      const healthReply = await sendRawChunked(
        Buffer.from(`${JSON.stringify({ type: "status", id: "post-partial" })}\n`, "utf8"),
        [1, 2, 3],
      );
      expect(JSON.parse(healthReply.trimEnd())).toMatchObject({
        type: "success",
        id: "post-partial",
      });

      const stopReply = await sendRawChunked(
        Buffer.from(`${JSON.stringify({ type: "stop", id: "final-stop" })}\n`, "utf8"),
        [3, 7, 15],
      );
      expect(JSON.parse(stopReply.trimEnd())).toMatchObject({
        type: "success",
        id: "final-stop",
        data: { stopped: true },
      });
      await daemonPromise;
    } finally {
      await sendRawChunked(
        Buffer.from(`${JSON.stringify({ type: "stop", id: "cleanup-stop" })}\n`, "utf8"),
        [10],
      ).catch(() => undefined);
      await Promise.race([daemonPromise, new Promise((r) => setTimeout(r, 1_000))]).catch(
        () => undefined,
      );
    }
  });
});
