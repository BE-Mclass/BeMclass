import { NextFunction, Request, Response } from "express";
import {
  exportAttendanceReport,
  generateStudentMonthlyReportPdf,
} from "../services/report.service";
import { AppError } from "../utils/errors";

function requireStaffActor(req: Request): {
  userId: number;
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
  return { userId: user.id, ip };
}

function requireStudentActor(req: Request): {
  rosterId: number;
  classId: number | null;
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
    rosterId: user.student.roster_id,
    classId: user.student.class_id ?? null,
  };
}

/**
 * US-44, D-14 & FSD §5.6 — GET /api/reports/attendance/export
 * Mengunduh file `.xlsx` rekap presensi kelas untuk Admin/Guru.
 */
export async function handleExportAttendanceReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, ip } = requireStaffActor(req);

    const result = await exportAttendanceReport({
      actorUserId: userId,
      ip,
      query: {
        format: req.query.format,
        from: req.query.from,
        to: req.query.to,
        date: req.query.date,
        class_id: req.query.class_id,
      },
    });

    if (String(req.query.format ?? "").trim().toLowerCase() === "json") {
      res.status(200).json({
        success: true,
        data: {
          filename: result.filename,
          from: result.from,
          to: result.to,
          class_id: result.class_id,
          sheets: result.sheets,
        },
      });
      return;
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );
    res.setHeader("Content-Length", String(result.buffer.length));
    res.status(200).send(result.buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * US-31 & FSD §5.4 — GET /api/me/reports/monthly
 * Mengunduh file `.xlsx` laporan kehadiran bulanan untuk Siswa.
 */
export async function handleGetStudentMonthlyReportPdf(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { rosterId, classId } = requireStudentActor(req);

    const result = await generateStudentMonthlyReportPdf({
      rosterId,
      studentClassId: classId,
      month: req.query.month,
    });

    if (String(req.query.format ?? "").trim().toLowerCase() === "json") {
      res.status(200).json({
        success: true,
        data: {
          filename: result.filename,
          month: result.month,
          student: result.student,
          summary: result.summary,
          days: result.days,
          sheets: result.sheets,
        },
      });
      return;
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );
    res.setHeader("Content-Length", String(result.buffer.length));
    res.status(200).send(result.buffer);
  } catch (error) {
    next(error);
  }
}
