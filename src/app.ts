import cors from "cors";
import express from "express";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import announcementRouter from "./routes/announcement.routes";
import attendanceRouter from "./routes/attendance.routes";
import auditRouter from "./routes/audit.routes";
import authRouter from "./routes/auth.routes";
import { calendarRouter, meAttendanceRouter } from "./routes/calendar.routes";
import { dashboardRouter, recapRouter } from "./routes/dashboard-recap.routes";
import deviceRouter from "./routes/device.routes";
import { faceRouter, studentsAdminRouter } from "./routes/face.routes";
import faceScanRouter from "./routes/face-scan.routes";
import fileRouter from "./routes/file.routes";
import jobRouter from "./routes/job.routes";
import leaveRouter from "./routes/leave.routes";
import notificationRouter from "./routes/notification.routes";
import profileRouter from "./routes/profile.routes";
import { meReportsRouter, reportsRouter } from "./routes/report.routes";
import rosterRouter from "./routes/roster.routes";
import schoolRouter from "./routes/school.routes";
import { getSystemHealth } from "./services/health.service";

const app = express();

app.use(cors());
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: true, limit: "6mb" }));

// FSD §1.4, §5.11 & TRD §9.5: Serve files (signed URL / avatars) via /api/files/:category/:filename
app.use("/api/files", fileRouter);

app.get("/api/health", async (_req, res) => {
  const health = await getSystemHealth();
  res.status(200).json(health);
});

app.use("/api/auth", authRouter);
app.use("/api/school", schoolRouter);
app.use("/api/roster", rosterRouter);
app.use("/api/face", faceRouter);
app.use("/api/face-scans", faceScanRouter);
app.use("/api/students", studentsAdminRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/recap", recapRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/announcements", announcementRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/me", meAttendanceRouter);
app.use("/api/me", profileRouter);
app.use("/api/me", meReportsRouter);
app.use("/api/leave-requests", leaveRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/devices", deviceRouter);
app.use("/api/audit-logs", auditRouter);
app.use("/api/jobs", jobRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
