import { Request, Response, NextFunction } from "express";
import { AuditService } from "../services/audit.service";
import {
  getStudentHomeroomTeacher,
  getStudentProfile,
  updateStudentProfile,
} from "../services/profile.service";
import { AppError } from "../utils/errors";

function requireStudentUserId(req: Request): number {
  const user = req.auth?.user;
  if (!user) {
    throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
      code: "UNAUTHENTICATED",
    });
  }
  if (user.role !== "siswa") {
    throw new AppError(
      "Akses ditolak. Endpoint ini hanya untuk siswa.",
      403,
      { code: "ROLE_NOT_ALLOWED" }
    );
  }
  return user.id;
}

/**
 * US-61 & FSD §5.10 — GET /api/me/profile
 */
export async function handleGetMyStudentProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireStudentUserId(req);
    const data = await getStudentProfile(userId);
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-61 & FSD §5.10 — PATCH /api/me/profile
 */
export async function handleUpdateMyStudentProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireStudentUserId(req);
    const data = await updateStudentProfile(userId, req.body);

    await AuditService.logSafe({
      actorUserId: userId,
      action: "student.profile.update",
      entity: "student_roster",
      entityId: String(data.id),
      meta: {
        nisn: data.nisn,
        updated_fields: Object.keys(req.body ?? {}),
      },
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message: "Profil siswa berhasil diperbarui.",
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-61 & FSD §5.10 — GET /api/me/homeroom
 */
export async function handleGetMyHomeroomTeacher(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireStudentUserId(req);
    const data = await getStudentHomeroomTeacher(userId);
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}
