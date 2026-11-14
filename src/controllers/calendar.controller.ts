import { NextFunction, Request, Response } from "express";
import {
  getCalendarEvents,
  getCalendarSummary,
  getStudentMonthlyAttendanceCalendar,
  getStudentTodayAttendanceStatus,
} from "../services/calendar.service";
import { AppError } from "../utils/errors";

function getAuthenticatedUser(req: Request) {
  if (!req.auth) {
    throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
      code: "UNAUTHORIZED",
    });
  }
  return req.auth.user;
}

function getStudentRosterProfile(req: Request) {
  const user = getAuthenticatedUser(req);
  if (user.role !== "siswa" || !user.student?.roster_id) {
    throw new AppError("Fitur ini hanya tersedia untuk akun siswa.", 403, {
      code: "ROLE_NOT_ALLOWED",
    });
  }
  return user.student;
}

/**
 * GET /api/calendar/events?month=YYYY-MM
 * US-50 & US-52 — Daftar agenda & hari libur pada bulan yang dipilih (untuk semua role)
 */
export async function handleGetCalendarEvents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = getAuthenticatedUser(req);
    const data = await getCalendarEvents({
      month: req.query.month,
      role: user.role,
      studentClassId: user.student?.class_id ?? null,
    });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/calendar/summary?month=YYYY-MM
 * US-50 & BR-42 — Kartu statistik kalender bulanan (Web Admin & Guru)
 */
export async function handleGetCalendarSummary(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = getAuthenticatedUser(req);
    const data = await getCalendarSummary({
      month: req.query.month,
      role: user.role,
    });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/me/attendance?month=YYYY-MM & GET /api/calendar/attendance?month=YYYY-MM
 * US-30 & US-52 — Kalender & riwayat kehadiran bulanan siswa (Mobile Siswa)
 */
export async function handleGetStudentMonthlyAttendance(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const student = getStudentRosterProfile(req);
    const data = await getStudentMonthlyAttendanceCalendar({
      rosterId: student.roster_id,
      studentClassId: student.class_id,
      month: req.query.month,
    });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/me/attendance/today
 * US-13 — Status presensi harian siswa hari ini
 */
export async function handleGetStudentTodayAttendance(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const student = getStudentRosterProfile(req);
    const data = await getStudentTodayAttendanceStatus({
      rosterId: student.roster_id,
      studentClassId: student.class_id,
    });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}
