import { Router } from "express";
import {
  handleGetCalendarEvents,
  handleGetCalendarSummary,
  handleGetStudentMonthlyAttendance,
  handleGetStudentTodayAttendance,
} from "../controllers/calendar.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

export const calendarRouter = Router();

calendarRouter.use(authenticate);

// US-50 & US-52 — Daftar event/agenda kalender bulanan (Web & Mobile)
calendarRouter.get("/events", handleGetCalendarEvents);

// US-50 — Ringkasan kartu kalender (Web Admin & Guru)
calendarRouter.get(
  "/summary",
  authorizeRoles("admin", "guru"),
  handleGetCalendarSummary
);

// US-52 — Kalender kehadiran & agenda bulanan untuk Siswa (Mobile)
calendarRouter.get(
  "/attendance",
  authorizeRoles("siswa"),
  handleGetStudentMonthlyAttendance
);

export const meAttendanceRouter = Router();

meAttendanceRouter.use(authenticate, authorizeRoles("siswa"));

// US-13 — Status presensi harian siswa hari ini
meAttendanceRouter.get("/attendance/today", handleGetStudentTodayAttendance);

// US-30 & US-52 — Riwayat & kalender kehadiran bulanan siswa (?month=YYYY-MM)
meAttendanceRouter.get("/attendance", handleGetStudentMonthlyAttendance);

export default calendarRouter;
