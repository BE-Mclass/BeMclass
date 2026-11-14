import crypto from "crypto";

export const ALLOWED_FILE_CATEGORIES = [
  "avatars",
  "attendance",
  "faces",
  "leaves",
] as const;

export type FileCategory = (typeof ALLOWED_FILE_CATEGORIES)[number];

const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9._-]+$/;

function getFileUrlSecret(): string {
  return (
    process.env.FILE_URL_SECRET ||
    process.env.JWT_SECRET ||
    "mclass-default-file-url-secret-key"
  );
}

function getDefaultFileTtlSeconds(): number {
  const raw = Number(process.env.FILE_URL_TTL ?? 600);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 600;
}

/**
 * Memastikan kategori dan nama file aman dari serangan Path Traversal (TRD §9.5).
 */
export function isSafeFileTarget(
  category: string,
  filename: string
): category is FileCategory {
  if (!ALLOWED_FILE_CATEGORIES.includes(category as FileCategory)) {
    return false;
  }
  if (
    !filename ||
    filename.length > 180 ||
    filename === "." ||
    filename === ".." ||
    filename.includes("..") ||
    !SAFE_FILENAME_REGEX.test(filename)
  ) {
    return false;
  }
  return true;
}

/**
 * Menghitung signature HMAC-SHA256 untuk payload `<category>|<filename>|<exp>` (TRD §9.5).
 */
export function computeFileSignature(
  category: string,
  filename: string,
  expUnixSeconds: number
): string {
  const payload = `${category}|${filename}|${expUnixSeconds}`;
  return crypto
    .createHmac("sha256", getFileUrlSecret())
    .update(payload)
    .digest("hex");
}

/**
 * Membuat URL bertanda tangan (signed URL) berumur pendek (default 10 menit / 600 dtk — FSD §1.4, TRD §9.5).
 * Format: `/api/files/<category>/<filename>?exp=<unix>&sig=<HMAC-SHA256>`
 */
export function createSignedFileUrl(params: {
  category: FileCategory;
  filename: string;
  ttlSeconds?: number;
  baseUrl?: string;
  nowMs?: number;
}): string {
  const { category, filename } = params;
  if (!isSafeFileTarget(category, filename)) {
    throw new Error("Kategori atau nama file tidak valid untuk signed URL.");
  }

  const ttl = params.ttlSeconds ?? getDefaultFileTtlSeconds();
  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  const exp = nowSec + ttl;
  const sig = computeFileSignature(category, filename, exp);

  const relativePath = `/api/files/${encodeURIComponent(category)}/${encodeURIComponent(filename)}?exp=${exp}&sig=${sig}`;
  if (params.baseUrl) {
    return `${params.baseUrl.replace(/\/+$/, "")}${relativePath}`;
  }
  return relativePath;
}

/**
 * Memverifikasi parameter `exp` dan `sig` menggunakan perbandingan *constant-time* (`timingSafeEqual` — TRD §9.5).
 */
export function verifySignedFileParams(params: {
  category: string;
  filename: string;
  exp: unknown;
  sig: unknown;
  nowMs?: number;
}): { valid: boolean; reason?: "INVALID_TARGET" | "MISSING_SIGNATURE" | "EXPIRED" | "INVALID_SIGNATURE" } {
  if (!isSafeFileTarget(params.category, params.filename)) {
    return { valid: false, reason: "INVALID_TARGET" };
  }

  const expStr = typeof params.exp === "string" ? params.exp.trim() : String(params.exp ?? "");
  const sigStr = typeof params.sig === "string" ? params.sig.trim() : "";

  if (!/^\d+$/.test(expStr) || !/^[a-fA-F0-9]{64}$/.test(sigStr)) {
    return { valid: false, reason: "MISSING_SIGNATURE" };
  }

  const expUnix = Number(expStr);
  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(expUnix) || expUnix < nowSec) {
    return { valid: false, reason: "EXPIRED" };
  }

  const expectedSigHex = computeFileSignature(
    params.category,
    params.filename,
    expUnix
  );

  const providedBuf = Buffer.from(sigStr.toLowerCase(), "hex");
  const expectedBuf = Buffer.from(expectedSigHex.toLowerCase(), "hex");

  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return { valid: false, reason: "INVALID_SIGNATURE" };
  }

  return { valid: true };
}
