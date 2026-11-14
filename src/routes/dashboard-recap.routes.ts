import { Router } from "express";
import {
  handleGetDashboardSummary,
  handleGetRecapClassDetail,
  handleGetRecapClasses,
  handleGetRecapLocation,
  handleGetRecapOverview,
} from "../controllers/dashboard-recap.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

/**
 * US-40 & FSD §5.6 — /api/dashboard
 */
export const dashboardRouter = Router();
dashboardRouter.use(authenticate, authorizeRoles("admin", "guru"));
dashboardRouter.get("/summary", handleGetDashboardSummary);

/**
 * US-41, US-43 & FSD §5.6 — /api/recap
 */
export const recapRouter = Router();
recapRouter.use(authenticate, authorizeRoles("admin", "guru"));
recapRouter.get("/overview", handleGetRecapOverview);
recapRouter.get("/classes", handleGetRecapClasses);
recapRouter.get("/classes/:classId", handleGetRecapClassDetail);
recapRouter.get("/location", handleGetRecapLocation);
