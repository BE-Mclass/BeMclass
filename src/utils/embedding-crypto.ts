import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function resolveEmbeddingKey(): Buffer {
  const rawKey =
    process.env.EMBEDDING_ENC_KEY?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "mclass-default-embedding-aes-256-gcm-secret-key";

  // Jika 64 karakter hex -> 32 byte
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }

  // Jika base64 yang menghasilkan tepat 32 byte
  try {
    const asBase64 = Buffer.from(rawKey, "base64");
    if (asBase64.length === 32) {
      return asBase64;
    }
  } catch {
    // Gunakan SHA-256 fallback di bawah
  }

  // Turunkan 32 byte secara deterministik via SHA-256
  return createHash("sha256").update(rawKey, "utf8").digest();
}

/**
 * TD-08 & TRD §7.5 — Enkripsi vektor embedding float32 menjadi Buffer biner:
 * Format: `iv(12 byte) | authTag(16 byte) | ciphertext(float32 little-endian)`
 */
export function encryptEmbedding(embedding: number[]): Buffer {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Vektor embedding tidak boleh kosong.");
  }

  const floatBuf = Buffer.allocUnsafe(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    floatBuf.writeFloatLE(Number(embedding[i]), i * 4);
  }

  const key = resolveEmbeddingKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(floatBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * TD-08 & TRD §7.5 — Dekripsi Buffer `face_templates.embedding` kembali menjadi `number[]` (float32).
 */
export function decryptEmbedding(payload: Buffer): number[] {
  if (!Buffer.isBuffer(payload) || payload.length <= IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error("Payload terenkripsi embedding tidak valid atau rusak.");
  }

  const iv = payload.subarray(0, IV_BYTES);
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);

  const key = resolveEmbeddingKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const floatBuf = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  if (floatBuf.length % 4 !== 0) {
    throw new Error("Ukuran hasil dekripsi embedding tidak kelipatan 4 byte (float32).");
  }

  const dim = floatBuf.length / 4;
  const result = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    result[i] = Number(floatBuf.readFloatLE(i * 4).toFixed(6));
  }
  return result;
}
