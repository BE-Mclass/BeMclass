import { Router } from "express";
import {
  handleGetSchoolConfig,
  handleUpdateSchoolGeofence,
  handleUpdateSchoolSchedule,
} from "../controllers/school.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const schoolRouter = Router();

schoolRouter.use(authenticate);

// P0 — FSD §5.2: Konfigurasi sekolah, geofence, & jadwal hari ini (semua role terautentikasi)
schoolRouter.get("/config", handleGetSchoolConfig);

// P1 — US-70 AC3 & FSD §5.2: Ubah geofence sekolah (khusus Admin)
schoolRouter.patch("/geofence", authorizeRoles("admin"), handleUpdateSchoolGeofence);
schoolRouter.put("/geofence", authorizeRoles("admin"), handleUpdateSchoolGeofence);

// P1 — US-70 AC3 & FSD §5.2: Ubah jadwal presensi per hari 1..7 (khusus Admin)
schoolRouter.put(
  "/schedule",
  authorizeRoles("admin"),
  handleUpdateSchoolSchedule
);
schoolRouter.patch(
  "/schedule",
  authorizeRoles("admin"),
  handleUpdateSchoolSchedule
);
schoolRouter.put(
  "/schedule/:dayOfWeek",
  authorizeRoles("admin"),
  handleUpdateSchoolSchedule
);
schoolRouter.patch(
  "/schedule/:dayOfWeek",
  authorizeRoles("admin"),
  handleUpdateSchoolSchedule
);

export default schoolRouter;
