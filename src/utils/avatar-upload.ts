import { Request } from "express";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { AppError } from "./errors";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB (sesuai FSD §5.1, FC-04 & Design System §10: JPG/PNG/WebP <= 2 MB)

interface DetectedImage {
  ext: "jpg" | "png" | "webp";
  mime: string;
}

/**
 * BR-70: Verifikasi tipe berkas dari isi file (magic bytes), bukan hanya ekstensi/header.
 */
function detectImageMagicBytes(buf: Buffer): DetectedImage | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
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
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

function parseMultipartFileBuffer(rawBody: Buffer, boundary: string): Buffer | null {
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const headerEndMarker = Buffer.from("\r\n\r\n");

  let pos = rawBody.indexOf(boundaryMarker);
  while (pos !== -1) {
    const partStart = pos + boundaryMarker.length;
    if (
      rawBody[partStart] === 0x2d &&
      rawBody[partStart + 1] === 0x2d
    ) {
      break; // Akhir multipart (--boundary--)
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

    // Hapus \r\n sebelum boundary berikutnya
    const contentEnd =
      rawBody[nextBoundary - 2] === 0x0d && rawBody[nextBoundary - 1] === 0x0a
        ? nextBoundary - 2
        : nextBoundary;

    if (/Content-Disposition:[^\r\n]*filename=/i.test(headersText) || /name="(file|avatar|photo)"/i.test(headersText)) {
      return rawBody.subarray(contentStart, contentEnd);
    }

    pos = nextBoundary;
  }

  return null;
}

async function readRawRequestBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes + 64 * 1024) {
        reject(
          new AppError("Ukuran foto profil melebihi batas maksimal (2 MB).", 413, {
            code: "FILE_TOO_LARGE",
          })
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

export async function extractAvatarUpload(req: Request): Promise<{
  buffer: Buffer;
  ext: "jpg" | "png" | "webp";
  mime: string;
}> {
  const contentType = String(req.headers["content-type"] ?? "");
  let fileBuffer: Buffer | null = null;

  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? "").trim();
    if (!boundary) {
      throw new AppError("Boundary multipart/form-data tidak ditemukan.", 400, {
        code: "VALIDATION_ERROR",
        errors: { file: "Format unggahan berkas tidak valid." },
      });
    }
    const rawBody = await readRawRequestBody(req, MAX_AVATAR_BYTES);
    fileBuffer = parseMultipartFileBuffer(rawBody, boundary);
  } else if (contentType.includes("application/json")) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawData =
      body.avatar ?? body.photo ?? body.file ?? body.photo_url ?? body.avatar_url;

    if (typeof rawData === "string" && rawData.trim() !== "") {
      const trimmed = rawData.trim();
      const dataUrlMatch = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
      const base64Payload = dataUrlMatch ? dataUrlMatch[1] : trimmed;
      fileBuffer = Buffer.from(base64Payload, "base64");
    }
  } else if (contentType.startsWith("image/")) {
    fileBuffer = await readRawRequestBody(req, MAX_AVATAR_BYTES);
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new AppError("File foto profil wajib disertakan.", 400, {
      code: "VALIDATION_ERROR",
      errors: { file: "Pilih foto profil (JPG, PNG, atau WebP)." },
    });
  }

  if (fileBuffer.length > MAX_AVATAR_BYTES) {
    throw new AppError("Ukuran foto profil melebihi batas maksimal (2 MB).", 413, {
      code: "FILE_TOO_LARGE",
    });
  }

  const detected = detectImageMagicBytes(fileBuffer);
  if (!detected) {
    throw new AppError(
      "Tipe file tidak didukung. Gunakan format JPG, PNG, atau WebP.",
      415,
      {
        code: "UNSUPPORTED_MEDIA",
        errors: { file: "Format foto harus JPG, PNG, atau WebP." },
      }
    );
  }

  return {
    buffer: fileBuffer,
    ext: detected.ext,
    mime: detected.mime,
  };
}

export function getUploadsAvatarDir(): string {
  const dir = path.join(process.cwd(), "uploads", "avatars");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveAvatarFile(buffer: Buffer, ext: string): string {
  const fileName = `${randomUUID()}.${ext}`;
  const fullPath = path.join(getUploadsAvatarDir(), fileName);
  fs.writeFileSync(fullPath, buffer);
  return `/api/files/avatars/${fileName}`;
}

export function removeOldAvatarFileIfLocal(photoUrl: string | null | undefined): void {
  if (!photoUrl || !photoUrl.startsWith("/api/files/avatars/")) {
    return;
  }
  const fileName = path.basename(photoUrl);
  const fullPath = path.join(getUploadsAvatarDir(), fileName);
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch {
    // Abaikan jika gagal menghapus file lama
  }
}
