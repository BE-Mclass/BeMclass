import { randomUUID } from "crypto";
import { Request } from "express";
import fs from "fs";
import path from "path";
import { AppError } from "./errors";

export const MAX_LEAVE_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB (BR-21 & BR-70)

export interface DetectedLeaveAttachment {
  ext: "pdf" | "jpg" | "png";
  mime: "application/pdf" | "image/jpeg" | "image/png";
}

export interface ParsedLeaveRequestUpload {
  fields: Record<string, string>;
  attachment: {
    buffer: Buffer;
    ext: "pdf" | "jpg" | "png";
    mime: "application/pdf" | "image/jpeg" | "image/png";
  };
}

/**
 * BR-70: Verifikasi tipe lampiran izin dari isi file (magic bytes), bukan hanya ekstensi/header.
 * Mendukung PDF (%PDF-), JPEG (FF D8 FF), dan PNG (89 50 4E 47 0D 0A 1A 0A).
 */
export function detectLeaveAttachmentMagicBytes(
  buf: Buffer
): DetectedLeaveAttachment | null {
  // PDF: %PDF- (25 50 44 46 2D)
  if (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  ) {
    return { ext: "pdf", mime: "application/pdf" };
  }

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

function parseMultipartFormAndFile(
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
      (fieldName && /^(attachment|file|lampiran)$/i.test(fieldName));

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
            "Ukuran lampiran surat izin melebihi batas maksimal (5 MB).",
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
 * Mengekstrak field form + berkas lampiran dari `multipart/form-data` atau JSON (base64).
 */
export async function extractLeaveRequestUpload(
  req: Request
): Promise<ParsedLeaveRequestUpload> {
  const contentType = String(req.headers["content-type"] ?? "");
  let fields: Record<string, string> = {};
  let fileBuffer: Buffer | null = null;

  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? "").trim();
    if (!boundary) {
      throw new AppError("Boundary multipart/form-data tidak ditemukan.", 400, {
        code: "VALIDATION_ERROR",
        errors: { attachment: "Format unggahan berkas tidak valid." },
      });
    }
    const rawBody = await readRawRequestBody(req, MAX_LEAVE_ATTACHMENT_BYTES);
    const parsed = parseMultipartFormAndFile(rawBody, boundary);
    fields = parsed.fields;
    fileBuffer = parsed.fileBuffer;
  } else {
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) {
      if (
        k !== "attachment" &&
        k !== "file" &&
        k !== "lampiran" &&
        v !== undefined &&
        v !== null
      ) {
        fields[k] = String(v);
      }
    }

    const rawAttachment = body.attachment ?? body.file ?? body.lampiran;
    if (Buffer.isBuffer(rawAttachment)) {
      fileBuffer = rawAttachment;
    } else if (typeof rawAttachment === "string" && rawAttachment.trim() !== "") {
      const trimmed = rawAttachment.trim();
      const dataUrlMatch = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
      const base64Payload = dataUrlMatch ? dataUrlMatch[1] : trimmed;
      fileBuffer = Buffer.from(base64Payload, "base64");
    }
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new AppError("Lampiran surat izin wajib disertakan.", 400, {
      code: "VALIDATION_ERROR",
      errors: {
        attachment:
          "Lampiran surat izin wajib diunggah (PDF, JPG, atau PNG maks. 5 MB).",
      },
    });
  }

  if (fileBuffer.length > MAX_LEAVE_ATTACHMENT_BYTES) {
    throw new AppError(
      "Ukuran lampiran surat izin melebihi batas maksimal (5 MB).",
      413,
      { code: "FILE_TOO_LARGE" }
    );
  }

  const detected = detectLeaveAttachmentMagicBytes(fileBuffer);
  if (!detected) {
    throw new AppError(
      "Tipe file lampiran tidak didukung. Gunakan format PDF, JPG, atau PNG.",
      415,
      {
        code: "UNSUPPORTED_MEDIA",
        errors: {
          attachment: "Format lampiran harus PDF, JPG, atau PNG.",
        },
      }
    );
  }

  return {
    fields,
    attachment: {
      buffer: fileBuffer,
      ext: detected.ext,
      mime: detected.mime,
    },
  };
}

export function getUploadsLeavesDir(): string {
  const baseUploadDir =
    process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const dir = path.join(baseUploadDir, "leaves");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveLeaveAttachmentFile(
  buffer: Buffer,
  ext: "pdf" | "jpg" | "png"
): { filename: string; relativePath: string; fullPath: string } {
  const filename = `${randomUUID()}.${ext}`;
  const fullPath = path.join(getUploadsLeavesDir(), filename);
  fs.writeFileSync(fullPath, buffer);
  return {
    filename,
    relativePath: `leaves/${filename}`,
    fullPath,
  };
}

export function resolveLeaveAttachmentFullPath(attachmentPath: string): string {
  const baseUploadDir =
    process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const filename = path.basename(attachmentPath);
  return path.join(baseUploadDir, "leaves", filename);
}
