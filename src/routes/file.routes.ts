import fs from "fs";
import path from "path";
import { NextFunction, Request, Response, Router } from "express";
import { verifyActiveSession } from "../services/auth.service";
import { AppError } from "../utils/errors";
import { verifyAccessToken } from "../utils/jwt";
import {
  isSafeFileTarget,
  verifySignedFileParams,
} from "../utils/signed-url";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

async function hasValidBearerSession(req: Request): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return false;
  }
  const payload = verifyAccessToken(token);
  if (!payload) {
    return false;
  }
  const activeUser = await verifyActiveSession(payload.jti, payload.sub);
  return Boolean(activeUser);
}

const fileRouter = Router();

/**
 * GET /api/files/:category/:filename
 * FSD §1.4, §5.11 & TRD §9.5:
 * Melayani file privat (foto presensi, wajah referensi, lampiran izin, avatar)
 * melalui URL bertanda tangan HMAC (`?exp=...&sig=...`) atau token Bearer aktif.
 */
fileRouter.get(
  "/:category/:filename",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const category = String(req.params.category ?? "").trim();
      const filename = String(req.params.filename ?? "").trim();

      if (!isSafeFileTarget(category, filename)) {
        throw new AppError("File tidak ditemukan.", 404, {
          code: "NOT_FOUND",
        });
      }

      const hasSignatureQuery =
        req.query.exp !== undefined || req.query.sig !== undefined;

      if (hasSignatureQuery) {
        const verification = verifySignedFileParams({
          category,
          filename,
          exp: req.query.exp,
          sig: req.query.sig,
        });
        if (!verification.valid) {
          throw new AppError(
            verification.reason === "EXPIRED"
              ? "Tautan file telah kedaluwarsa."
              : "Tautan file tidak valid.",
            403,
            { code: "FORBIDDEN" }
          );
        }
      } else if (category !== "avatars") {
        // Selain avatar profil, file privat wajib menggunakan signed URL atau sesi Bearer aktif
        const isBearerValid = await hasValidBearerSession(req);
        if (!isBearerValid) {
          throw new AppError(
            "Akses file membutuhkan tautan bertanda tangan (signed URL) atau sesi login yang valid.",
            401,
            { code: "UNAUTHENTICATED" }
          );
        }
      }

      const baseUploadDir =
        process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
      const filePath = path.resolve(baseUploadDir, category, filename);
      const expectedDir = path.resolve(baseUploadDir, category);

      // Pastikan file berada di dalam direktori kategori yang diizinkan
      if (!filePath.startsWith(expectedDir + path.sep)) {
        throw new AppError("File tidak ditemukan.", 404, {
          code: "NOT_FOUND",
        });
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new AppError("File tidak ditemukan.", 404, {
          code: "NOT_FOUND",
        });
      }

      const ext = path.extname(filename).toLowerCase();
      const mimeType = MIME_BY_EXT[ext] || "application/octet-stream";

      res.setHeader("Content-Type", mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${path.basename(filename)}"`
      );
      res.setHeader("Cache-Control", "private, max-age=300");

      const stream = fs.createReadStream(filePath);
      stream.on("error", (err) => next(err));
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  }
);

export default fileRouter;
