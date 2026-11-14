import { NextFunction, Request, Response } from "express";
import { AuditService } from "../services/audit.service";
import {
  getSchoolConfig,
  updateSchoolGeofence,
  updateSchoolScheduleByDay,
} from "../services/school.service";

/**
 * GET /api/school/config (P0 — FSD §5.2)
 * Mengambil konfigurasi sekolah, geofence (latitude, longitude, radius_m),
 * jadwal presensi hari ini (`today`), dan jadwal 7 hari (`schedules`).
 */
export async function handleGetSchoolConfig(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getSchoolConfig();
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/school/geofence (P1 — Admin, US-70 AC3, FSD §5.2)
 * Mengubah koordinat pusat sekolah, radius geofence, atau nama sekolah.
 */
export async function handleUpdateSchoolGeofence(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await updateSchoolGeofence(req.body);
    await AuditService.logSafe({
      actorUserId: req.auth?.user.id ?? null,
      action: "school.geofence.update",
      entity: "school_settings",
      entityId: 1,
      meta: {
        school_name: data.school_name,
        geofence: data.geofence,
        timezone: data.timezone,
      },
      ip: req.ip,
    });
    res.status(200).json({
      success: true,
      message: "Konfigurasi geofence sekolah berhasil diperbarui.",
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/school/schedule/:dayOfWeek (P1 — Admin, US-70 AC3, FSD §5.2)
 * Mengubah jadwal hari sekolah & jam presensi untuk hari ke-1 (Senin) s.d. ke-7 (Minggu).
 */
export async function handleUpdateSchoolSchedule(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const paramDay = req.params.dayOfWeek;
    const bodyDay =
      req.body && typeof req.body === "object"
        ? (req.body.day_of_week ?? req.body.dayOfWeek)
        : undefined;
    const resolvedDay =
      paramDay && paramDay !== ":dayOfWeek" ? paramDay : bodyDay ?? paramDay;

    const data = await updateSchoolScheduleByDay(resolvedDay, req.body);
    await AuditService.logSafe({
      actorUserId: req.auth?.user.id ?? null,
      action: "school.schedule.update",
      entity: "attendance_schedules",
      entityId: data.schedule.day_of_week,
      meta: { ...data.schedule },
      ip: req.ip,
    });
    res.status(200).json({
      success: true,
      message: `Jadwal presensi hari ${data.schedule.day_name} berhasil diperbarui.`,
      data,
    });
  } catch (error) {
    next(error);
  }
}
