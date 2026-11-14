import { Router } from "express";
import {
  handleCheckInAttendance,
  handleSubmitLateReason,
} from "../controllers/attendance.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const attendanceRouter = Router();

// Seluruh endpoint presensi masuk & alasan terlambat khusus role siswa (🎒 US-11 & US-12, FSD §5.4)
attendanceRouter.use(authenticate, authorizeRoles("siswa"));

// POST /api/attendance/check-in — Presensi masuk (GPS Haversine + Verifikasi Wajah Otomatis)
attendanceRouter.post("/check-in", handleCheckInAttendance);

// PATCH /api/attendance/:id/late-reason (serta alias PUT/POST) — Kirim alasan terlambat
attendanceRouter.patch("/:id/late-reason", handleSubmitLateReason);
attendanceRouter.put("/:id/late-reason", handleSubmitLateReason);
attendanceRouter.post("/:id/late-reason", handleSubmitLateReason);

export default attendanceRouter;
