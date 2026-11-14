import { Router } from "express";
import {
  handleGetMyHomeroomTeacher,
  handleGetMyStudentProfile,
  handleUpdateMyStudentProfile,
} from "../controllers/profile.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const profileRouter = Router();

// Seluruh endpoint /api/me/profile & /api/me/homeroom khusus role siswa (🎒 US-61, FSD §5.10)
profileRouter.use(authenticate, authorizeRoles("siswa"));

// GET /api/me/profile — Tampilkan profil akademik terkunci & kontak siswa
profileRouter.get("/profile", handleGetMyStudentProfile);

// PATCH /api/me/profile (serta alias PUT) — Ubah nomor WA (phone) & alamat siswa
profileRouter.patch("/profile", handleUpdateMyStudentProfile);
profileRouter.put("/profile", handleUpdateMyStudentProfile);

// GET /api/me/homeroom — Tampilkan nama & kontak wali kelas dari kelas siswa
profileRouter.get("/homeroom", handleGetMyHomeroomTeacher);

export default profileRouter;
