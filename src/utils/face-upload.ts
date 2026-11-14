import { randomUUID } from "crypto";
import { Request } from "express";
import fs from "fs";
import path from "path";
import { AppError } from "./errors";

const DEFAULT_PHOTO_MAX_MB = Number(process.env.PHOTO_MAX_MB ?? 3);
export const MAX_FACE_PHOTO_BYTES = DEFAULT_PHOTO_MAX_MB * 1024 * 1024; // 3 MB per photo (BR-70)
export const ENROLL_MIN_SAMPLES = Number(process.env.ENROLL_MIN_SAMPLES ?? 3);
export const ENROLL_MAX_SAMPLES = Number(process.env.ENROLL_MAX_SAMPLES ?? 5);

export interface ValidatedFacePhoto {
  buffer: Buffer;
  ext: "jpg" | "png";
  mime: "image/jpeg" | "image/png";
}

export interface ParsedFaceEnrollPayload {
  consent: boolean;
  photos: ValidatedFacePhoto[];
}

/**
 * BR-70: Verifikasi tipe foto presensi/enrollment dari magic bytes (hanya JPEG & PNG).
 */
export function detectFacePhotoMagicBytes(
  buf: Buffer
): { ext: "jpg" | "png"; mime: "image/jpeg" | "image/png" } | null {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }

  return null;
}

function parseMultipartEnrollBody(
  rawBody: Buffer,
  boundary: string
): { fields: Record<string, string>; fileBuffers: Buffer[] } {
  const fields: Record<string, string> = {};
  const fileBuffers: Buffer[] = [];

  const boundaryMarker = Buffer.from(`--${boundary}`);
  const headerEndMarker = Buffer.from("\r\n\r\n");

  let pos = rawBody.indexOf(boundaryMarker);
  while (pos !== -1) {
    const partStart = pos + boundaryMarker.length;
    if (rawBody[partStart] === 0x2d && rawBody[partStart + 1] === 0x2d) {
      break;
    }

    const headerEnd = rawBody.indexOf(headerEndMarker, partStart);
    if (headerEnd === -1) {
      break;
    }

    const headersText = rawBody
      .subarray(partStart, headerEnd)
      .toString("utf8");
    const contentStart = headerEnd + 4;
    const nextBoundary = rawBody.indexOf(boundaryMarker, contentStart);
    if (nextBoundary === -1) {
      break;
    }

    const contentEnd =
      rawBody[nextBoundary - 2] === 0x0d && rawBody[nextBoundary - 1] === 0x0a
        ? nextBoundary - 2
        : nextBoundary;

    const partContent = rawBody.subarray(contentStart, contentEnd);
    const nameMatch = headersText.match(/\bname="([^"]+)"/i);
    const fieldName = nameMatch?.[1]?.trim();
    const isFilePart =
      /Content-Disposition:[^\r\n]*filename=/i.test(headersText) ||
      (fieldName && /^(photos|photos\[\]|photo|images|files)$/i.test(fieldName));

    if (isFilePart && partContent.length > 0) {
      fileBuffers.push(partContent);
    } else if (fieldName) {
      fields[fieldName] = partContent.toString("utf8").trim();
    }

    pos = nextBoundary;
  }

  return { fields, fileBuffers };
}

async function readRawRequestBody(
  req: Request,
  maxTotalBytes: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxTotalBytes) {
        reject(
          new AppError(
            `Ukuran unggahan foto melebihi batas maksimal (${DEFAULT_PHOTO_MAX_MB} MB per foto).`,
            413,
            { code: "FILE_TOO_LARGE" }
          )
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (err) => reject(err));
  });
}

function parseConsentValue(raw: unknown): boolean {
  if (raw === true || raw === 1) {
    return true;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

/**
 * US-10, BR-20 & BR-70 — Mengekstrak persetujuan biometrik (`consent`) dan 3–5 foto wajah
 * dari `multipart/form-data` atau `application/json` (array base64).
 */
export async function extractFaceEnrollUpload(
  req: Request
): Promise<ParsedFaceEnrollPayload> {
  const contentType = String(req.headers["content-type"] ?? "");
  let rawConsent: unknown;
  const rawBuffers: Buffer[] = [];

  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? "").trim();
    if (!boundary) {
      throw new AppError("Boundary multipart/form-data tidak ditemukan.", 400, {
        code: "VALIDATION_ERROR",
        errors: { photos: "Format unggahan berkas tidak valid." },
      });
    }
    const maxTotalMultipart =
      MAX_FACE_PHOTO_BYTES * (ENROLL_MAX_SAMPLES + 1) + 256 * 1024;
    const rawBody = await readRawRequestBody(req, maxTotalMultipart);
    const parsed = parseMultipartEnrollBody(rawBody, boundary);
    rawConsent =
      parsed.fields.consent ??
      parsed.fields.biometric_consent ??
      parsed.fields.biometricConsent;
    rawBuffers.push(...parsed.fileBuffers);
  } else {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rawConsent =
      body.consent ?? body.biometric_consent ?? body.biometricConsent;

    const rawPhotos = body.photos ?? body.images ?? body.files;
    if (Array.isArray(rawPhotos)) {
      for (const item of rawPhotos) {
        if (Buffer.isBuffer(item)) {
          rawBuffers.push(item);
        } else if (typeof item === "string" && item.trim() !== "") {
          const trimmed = item.trim();
          const dataUrlMatch = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
          const base64Payload = dataUrlMatch ? dataUrlMatch[1] : trimmed;
          rawBuffers.push(Buffer.from(base64Payload, "base64"));
        }
      }
    }
  }

  // FSD §5.3 & BR-20: Tanpa consent -> 400 CONSENT_REQUIRED
  const consent = parseConsentValue(rawConsent);
  if (!consent) {
    throw new AppError(
      "Persetujuan penggunaan data biometrik (consent) wajib disetujui sebelum mendaftarkan wajah.",
      400,
      {
        code: "CONSENT_REQUIRED",
        errors: {
          consent: "Anda harus menyetujui penggunaan data biometrik wajah.",
        },
      }
    );
  }

  // BR-20: Terima ENROLL_MIN_SAMPLES (3) hingga ENROLL_MAX_SAMPLES (5) foto
  if (
    rawBuffers.length < ENROLL_MIN_SAMPLES ||
    rawBuffers.length > ENROLL_MAX_SAMPLES
  ) {
    throw new AppError(
      `Pendaftaran wajah membutuhkan ${ENROLL_MIN_SAMPLES} hingga ${ENROLL_MAX_SAMPLES} sampel foto.`,
      400,
      {
        code: "VALIDATION_ERROR",
        errors: {
          photos: `Unggah antara ${ENROLL_MIN_SAMPLES} hingga ${ENROLL_MAX_SAMPLES} foto wajah.`,
        },
      }
    );
  }

  const validatedPhotos: ValidatedFacePhoto[] = [];
  for (let i = 0; i < rawBuffers.length; i++) {
    const buf = rawBuffers[i];
    if (buf.length > MAX_FACE_PHOTO_BYTES) {
      throw new AppError(
        `Ukuran foto sampel ke-${i + 1} melebihi batas maksimal (${DEFAULT_PHOTO_MAX_MB} MB).`,
        413,
        { code: "FILE_TOO_LARGE" }
      );
    }

    const detected = detectFacePhotoMagicBytes(buf);
    if (!detected) {
      throw new AppError(
        `Format foto sampel ke-${i + 1} tidak didukung. Gunakan format JPG atau PNG.`,
        415,
        {
          code: "UNSUPPORTED_MEDIA",
          errors: {
            photos: "Seluruh foto wajah harus berformat JPG atau PNG.",
          },
        }
      );
    }

    validatedPhotos.push({
      buffer: buf,
      ext: detected.ext,
      mime: detected.mime,
    });
  }

  return {
    consent: true,
    photos: validatedPhotos,
  };
}

export function getUploadsFacesDir(): string {
  const baseUploadDir =
    process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const dir = path.join(baseUploadDir, "faces");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveFaceReferencePhoto(
  buffer: Buffer,
  ext: "jpg" | "png"
): { filename: string; relativePath: string; fullPath: string } {
  const filename = `${randomUUID()}.${ext}`;
  const fullPath = path.join(getUploadsFacesDir(), filename);
  fs.writeFileSync(fullPath, buffer);
  return {
    filename,
    relativePath: `faces/${filename}`,
    fullPath,
  };
}

export function removeFaceReferencePhotoIfExists(
  photoPath: string | null | undefined
): void {
  if (!photoPath) {
    return;
  }
  const baseUploadDir =
    process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const filename = path.basename(photoPath);
  const fullPath = path.join(baseUploadDir, "faces", filename);
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch {
    // Abaikan kegagalan hapus file lama
  }
}
