import { Router } from "express";
import {
  handleExportAttendanceReport,
  handleGetStudentMonthlyReportPdf,
} from "../controllers/report.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

/**
 * US-44 & FSD §5.6 — /api/reports
 */
export const reportsRouter = Router();
reportsRouter.use(authenticate, authorizeRoles("admin", "guru"));
reportsRouter.get("/attendance/export", handleExportAttendanceReport);

/**
 * US-31 & FSD §5.4 — /api/me/reports
 */
export const meReportsRouter = Router();
meReportsRouter.use(authenticate, authorizeRoles("siswa"));
meReportsRouter.get("/reports/monthly", handleGetStudentMonthlyReportPdf);
