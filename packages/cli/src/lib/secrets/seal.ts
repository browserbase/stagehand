import { Aes256Gcm, CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { fail } from "../errors.js";

export async function sealSecret(
  publicKey: unknown,
  value: Uint8Array,
): Promise<string> {
  if (typeof publicKey !== "string") {
    fail("The secrets API returned an invalid X25519 public key.");
  }
  const rawKey = Buffer.from(publicKey, "base64");
  if (rawKey.length !== 32 || rawKey.toString("base64") !== publicKey) {
    fail("The secrets API returned an invalid X25519 public key.");
  }
  const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
  try {
    const recipientPublicKey = await suite.kem.deserializePublicKey(
      new Uint8Array(rawKey).buffer,
    );
    const sender = await suite.createSenderContext({ recipientPublicKey });
    const ciphertext = await sender.seal(new Uint8Array(value).buffer);
    // Go's crypto/hpke.Open expects the encapsulated key followed by ciphertext.
    return Buffer.concat([
      Buffer.from(sender.enc),
      Buffer.from(ciphertext),
    ]).toString("base64");
  } catch {
    fail("Failed to encrypt the secret with the project's public key.");
  }
}
