import { Router } from "express";
import {
  handleEnrollFace,
  handleGetFaceStatus,
  handleResetStudentFace,
} from "../controllers/face.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

export const faceRouter = Router();

faceRouter.use(authenticate);

// GET /api/face/status — Status enrollment wajah siswa (🎒 US-10)
faceRouter.get("/status", authorizeRoles("siswa"), handleGetFaceStatus);

// POST /api/face/enroll — Pendaftaran 3–5 sampel wajah siswa (🎒 US-10, BR-20)
faceRouter.post("/enroll", authorizeRoles("siswa"), handleEnrollFace);

// Alias di bawah /api/face: POST /api/face/reset/:nisn (🛡 Admin P1)
faceRouter.post("/reset/:nisn", authorizeRoles("admin"), handleResetStudentFace);
faceRouter.post("/reset", authorizeRoles("admin"), handleResetStudentFace);

export const studentsAdminRouter = Router();

studentsAdminRouter.use(authenticate, authorizeRoles("admin"));

// POST /api/students/:nisn/face/reset — Admin mereset enrollment wajah siswa (🛡 P1, FSD §5.3)
studentsAdminRouter.post("/:nisn/face/reset", handleResetStudentFace);

export default faceRouter;
