import { randomUUID } from "crypto";
import { Request } from "express";
import fs from "fs";
import path from "path";
import { AppError } from "./errors";
import {
  detectFacePhotoMagicBytes,
  MAX_FACE_PHOTO_BYTES,
  ValidatedFacePhoto,
} from "./face-upload";

export interface ParsedAttendanceCheckInUpload {
  fields: Record<string, unknown>;
  photo: ValidatedFacePhoto;
}

function parseMultipartCheckInBody(
  rawBody: Buffer,
  boundary: string
): { fields: Record<string, string>; fileBuffer: Buffer | null } {
  const fields: Record<string, string> = {};
  let fileBuffer: Buffer | null = null;

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
      (fieldName && /^(photo|image|file|foto)$/i.test(fieldName));

    if (isFilePart && !fileBuffer && partContent.length > 0) {
      fileBuffer = partContent;
    } else if (fieldName) {
      fields[fieldName] = partContent.toString("utf8").trim();
    }

    pos = nextBoundary;
  }

  return { fields, fileBuffer };
}

async function readRawRequestBody(
  req: Request,
  maxBytes: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes + 128 * 1024) {
        reject(
          new AppError(
            "Ukuran foto presensi melebihi batas maksimal (3 MB).",
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

/**
 * US-11, BR-70 & FSD §5.4 — Mengekstrak foto kamera depan (`photo`) dan field GPS
 * (`latitude`, `longitude`, `accuracy_m`, `is_mocked`, `captured_at`, `device`)
 * dari `multipart/form-data` atau `application/json` (base64).
 */
export async function extractAttendanceCheckInUpload(
  req: Request
): Promise<ParsedAttendanceCheckInUpload> {
  const contentType = String(req.headers["content-type"] ?? "");
  let fields: Record<string, unknown> = {};
  let fileBuffer: Buffer | null = null;

  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? "").trim();
    if (!boundary) {
      throw new AppError("Boundary multipart/form-data tidak ditemukan.", 400, {
        code: "VALIDATION_ERROR",
        errors: { photo: "Format unggahan berkas tidak valid." },
      });
    }
    const rawBody = await readRawRequestBody(req, MAX_FACE_PHOTO_BYTES);
    const parsed = parseMultipartCheckInBody(rawBody, boundary);
    fields = parsed.fields;
    fileBuffer = parsed.fileBuffer;
  } else {
    const body = (req.body ?? {}) as Record<string, unknown>;
    fields = { ...body };
    const rawPhoto = body.photo ?? body.image ?? body.file ?? body.foto;
    if (Buffer.isBuffer(rawPhoto)) {
      fileBuffer = rawPhoto;
    } else if (typeof rawPhoto === "string" && rawPhoto.trim() !== "") {
      const trimmed = rawPhoto.trim();
      const dataUrlMatch = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
      const base64Payload = dataUrlMatch ? dataUrlMatch[1] : trimmed;
      fileBuffer = Buffer.from(base64Payload, "base64");
    }
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new AppError("Foto kamera depan wajib disertakan untuk presensi.", 400, {
      code: "VALIDATION_ERROR",
      errors: {
        photo: "Foto kamera depan wajib disertakan (JPG atau PNG maks. 3 MB).",
      },
    });
  }

  if (fileBuffer.length > MAX_FACE_PHOTO_BYTES) {
    throw new AppError(
      "Ukuran foto presensi melebihi batas maksimal (3 MB).",
      413,
      { code: "FILE_TOO_LARGE" }
    );
  }

  const detected = detectFacePhotoMagicBytes(fileBuffer);
  if (!detected) {
    throw new AppError(
      "Format foto presensi tidak didukung. Gunakan format JPG atau PNG.",
      415,
      {
        code: "UNSUPPORTED_MEDIA",
        errors: {
          photo: "Format foto presensi harus JPG atau PNG.",
        },
      }
    );
  }

  return {
    fields,
    photo: {
      buffer: fileBuffer,
      ext: detected.ext,
      mime: detected.mime,
    },
  };
}

export function getUploadsAttendanceDir(): string {
  const baseUploadDir =
    process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const dir = path.join(baseUploadDir, "attendance");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveAttendanceAttemptPhoto(
  buffer: Buffer,
  ext: "jpg" | "png"
): { filename: string; relativePath: string; fullPath: string } {
  const filename = `${randomUUID()}.${ext}`;
  const fullPath = path.join(getUploadsAttendanceDir(), filename);
  fs.writeFileSync(fullPath, buffer);
  return {
    filename,
    relativePath: `attendance/${filename}`,
    fullPath,
  };
}
