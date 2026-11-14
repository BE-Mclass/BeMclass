import { NextFunction, Request, Response } from "express";
import {
  getFaceScanDetail,
  listFaceScans,
} from "../services/face-scan.service";
import { AppError } from "../utils/errors";

function requireStaffActor(req: Request): {
  userId: number;
  role: "admin" | "guru";
  ip: string | null;
} {
  const user = req.auth?.user;
  if (!user) {
    throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
      code: "UNAUTHENTICATED",
    });
  }
  if (user.role !== "admin" && user.role !== "guru") {
    throw new AppError("Akses ditolak.", 403, {
      code: "ROLE_NOT_ALLOWED",
    });
  }
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim() || req.ip || null
      : req.ip || null;
  return {
    userId: user.id,
    role: user.role,
    ip,
  };
}

/**
 * US-42, BR-19 & FSD §5.7 — GET /api/face-scans
 * Menampilkan daftar percobaan scan wajah siswa (read-only untuk admin & guru).
 */
export async function handleListFaceScans(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    requireStaffActor(req);

    const result = await listFaceScans({
      class_id: req.query.class_id,
      date: req.query.date,
      nisn: req.query.nisn,
      result: req.query.result,
      outcome: req.query.outcome,
      q: req.query.q,
      all: req.query.all,
      page: req.query.page,
      limit: req.query.limit,
    });

    res.status(200).json({
      success: true,
      data: result.items,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-42, BR-19 & FSD §5.7 — GET /api/face-scans/:scanId
 * Menampilkan detail percobaan scan wajah (foto scan vs foto referensi, skor kemiripan,
 * jarak vs radius, serta record presensi terkait) dan mencatat akses ke `audit_logs` (`face_scan.view`).
 */
export async function handleGetFaceScanDetail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, ip } = requireStaffActor(req);

    const rawScanId = String(req.params.scanId ?? "").trim();
    if (!/^\d+$/.test(rawScanId)) {
      throw new AppError("ID hasil scan wajah tidak valid.", 400, {
        code: "VALIDATION_ERROR",
        errors: { scanId: "scanId harus berupa bilangan bulat positif." },
      });
    }

    const data = await getFaceScanDetail({
      scanId: Number(rawScanId),
      actorUserId: userId,
      ip,
    });

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}
