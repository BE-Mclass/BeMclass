import { NextFunction, Request, Response } from "express";
import {
  checkInStudentAttendance,
  submitLateAttendanceReason,
} from "../services/attendance.service";
import { extractAttendanceCheckInUpload } from "../utils/attendance-upload";
import { AppError } from "../utils/errors";
import { nowUtc, toWibDate } from "../utils/wib-time";

function parseMockServerTimeHeader(rawHeader: unknown): Date | undefined {
  if (process.env.NODE_ENV === "production" || typeof rawHeader !== "string") {
    return undefined;
  }
  const trimmed = rawHeader.trim();
  if (!trimmed) {
    return undefined;
  }
  // Support "HH:mm" or "HH:mm:ss" (uses today's WIB date)
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(trimmed);
  if (timeMatch) {
    const todayWib = toWibDate(nowUtc());
    const hh = timeMatch[1];
    const mm = timeMatch[2];
    const ss = timeMatch[3] ?? "00";
    const parsed = new Date(`${todayWib}T${hh}:${mm}:${ss}+07:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  // Support full ISO date/time string
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function requireStudentContext(req: Request): {
  userId: number;
  rosterId: number;
} {
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
  return {
    userId: user.id,
    rosterId: user.student.roster_id,
  };
}

/**
 * US-11 & FSD §5.4 — POST /api/attendance/check-in
 */
export async function handleCheckInAttendance(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, rosterId } = requireStudentContext(req);
    const parsedUpload = await extractAttendanceCheckInUpload(req);

    // Di lingkungan dev/lokal, header X-Mock-AI: true mengizinkan verifikasi deterministik tanpa Flask aktif
    const allowDevFallback =
      process.env.NODE_ENV !== "production" &&
      String(req.headers["x-mock-ai"] ?? "").toLowerCase() === "true";

    const serverNowOverride = parseMockServerTimeHeader(
      req.headers["x-mock-time"]
    );

    const data = await checkInStudentAttendance({
      studentRosterId: rosterId,
      studentUserId: userId,
      fields: parsedUpload.fields,
      photo: parsedUpload.photo,
      allowDevFallback,
      serverNowOverride,
    });

    res.status(201).json({
      success: true,
      message: data.message,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-12 & FSD §5.4 — PATCH /api/attendance/:id/late-reason
 */
export async function handleSubmitLateReason(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { rosterId } = requireStudentContext(req);
    const rawId = String(req.params.id ?? "").trim();
    if (!/^\d+$/.test(rawId)) {
      throw new AppError("ID presensi tidak valid.", 400, {
        code: "VALIDATION_ERROR",
        errors: { id: "ID presensi harus berupa bilangan bulat positif." },
      });
    }

    const data = await submitLateAttendanceReason({
      recordId: Number(rawId),
      studentRosterId: rosterId,
      payload: req.body,
    });

    res.status(200).json({
      success: true,
      message: "Alasan keterlambatan berhasil disimpan.",
      data,
    });
  } catch (error) {
    next(error);
  }
}
