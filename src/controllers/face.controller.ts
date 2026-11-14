import { NextFunction, Request, Response } from "express";
import { AuditService } from "../services/audit.service";
import {
  enrollStudentFace,
  getStudentFaceStatus,
  resetStudentFaceEnrollment,
} from "../services/face.service";
import { AppError } from "../utils/errors";
import { extractFaceEnrollUpload } from "../utils/face-upload";

function requireStudentRosterId(req: Request): number {
  const user = req.auth?.user;
  if (!user) {
    throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
      code: "UNAUTHENTICATED",
    });
  }
  if (user.role !== "siswa") {
    throw new AppError("Fitur ini hanya tersedia untuk akun siswa.", 403, {
      code: "ROLE_NOT_ALLOWED",
    });
  }
  if (!user.student?.roster_id) {
    throw new AppError("Data profil roster siswa tidak ditemukan.", 404, {
      code: "ROSTER_NOT_FOUND",
    });
  }
  return user.student.roster_id;
}

/**
 * US-10 & FSD §5.3 — GET /api/face/status
 */
export async function handleGetFaceStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const studentRosterId = requireStudentRosterId(req);
    const data = await getStudentFaceStatus(studentRosterId);
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-10, BR-20 & FSD §5.3 — POST /api/face/enroll
 */
export async function handleEnrollFace(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const studentRosterId = requireStudentRosterId(req);
    const parsedUpload = await extractFaceEnrollUpload(req);

    // Di lingkungan dev/lokal, header X-Mock-AI: true mengizinkan simulasi tanpa Flask aktif
    const allowDevFallback =
      process.env.NODE_ENV !== "production" &&
      String(req.headers["x-mock-ai"] ?? "").toLowerCase() === "true";

    const data = await enrollStudentFace({
      studentRosterId,
      photos: parsedUpload.photos,
      allowDevFallback,
    });

    await AuditService.logSafe({
      actorUserId: req.auth?.user.id ?? null,
      action: "face.enroll.completed",
      entity: "student_roster",
      entityId: String(studentRosterId),
      meta: {
        samples_accepted: data.samples_accepted,
        rejected_count: data.rejected.length,
      },
      ip: req.ip,
    });

    res.status(201).json({
      success: true,
      message: "Pendaftaran wajah berhasil disimpan.",
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * FSD §5.3 & US-70 AC3 (P1 Admin) — POST /api/students/:nisn/face/reset
 */
export async function handleResetStudentFace(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.auth?.user;
    if (!user) {
      throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
        code: "UNAUTHENTICATED",
      });
    }
    if (user.role !== "admin") {
      throw new AppError(
        "Akses ditolak. Hanya Admin yang dapat mereset enrollment wajah siswa.",
        403,
        { code: "ROLE_NOT_ALLOWED" }
      );
    }

    const rawParam = String(req.params.nisn ?? "").trim();
    const bodyNisn = String(req.body?.nisn ?? req.body?.student_id ?? "").trim();
    const targetNisn =
      !rawParam || rawParam.startsWith(":") ? bodyNisn : rawParam;

    const data = await resetStudentFaceEnrollment(targetNisn);

    await AuditService.logSafe({
      actorUserId: user.id,
      action: "face.enrollment.reset",
      entity: "student_roster",
      entityId: String(data.student_id),
      meta: {
        nisn: data.nisn,
        student_name: data.student_name,
        revoked_templates: data.revoked_templates,
      },
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message: "Data enrollment wajah siswa berhasil direset.",
      data,
    });
  } catch (error) {
    next(error);
  }
}
