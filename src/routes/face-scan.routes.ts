import { Router } from "express";
import {
  handleGetFaceScanDetail,
  handleListFaceScans,
} from "../controllers/face-scan.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

/**
 * US-42, BR-19 & FSD §5.7 — Hasil Scan Wajah (Read-Only untuk Web Admin/Guru)
 * Tidak ada endpoint ubah/setujui/tolak karena keputusan presensi wajah sepenuhnya otomatis (BR-14).
 */
const faceScanRouter = Router();

faceScanRouter.use(authenticate, authorizeRoles("admin", "guru"));

faceScanRouter.get("/", handleListFaceScans);
faceScanRouter.get("/:scanId", handleGetFaceScanDetail);

export default faceScanRouter;
