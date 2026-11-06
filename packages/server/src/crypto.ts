import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM envelope for values at rest. Format: `v1.<base64(iv | tag | ciphertext)>`. */
export class Vault {
  private readonly key: Buffer;

  constructor(masterKey: string) {
    if (masterKey.length < 16) throw new Error("master key must be at least 16 characters");
    this.key = createHash("sha256").update(masterKey).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
  }

  decrypt(envelope: string): string {
    if (!envelope.startsWith("v1.")) throw new Error("unknown ciphertext version");
    const data = Buffer.from(envelope.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
