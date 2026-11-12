import { Router } from "express";
import {
  handleChangePassword,
  handleGetMe,
  handleListSessions,
  handleLogout,
  handleMobileGoogleOAuth,
  handleMobileLogin,
  handleRevokeSession,
  handleStudentRegister,
  handleUnifiedLogin,
  handleUpdateProfile,
  handleWebLogin,
} from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";

const authRouter = Router();

// US-01 — Admin/Guru login (Web)
authRouter.post("/web/login", handleWebLogin);
authRouter.post("/admin/login", handleWebLogin);

// US-02 — Siswa login (Mobile: email atau NISN 10 digit)
authRouter.post("/mobile/login", handleMobileLogin);

// US-02B — Siswa login dengan Google OAuth (Mobile)
authRouter.post("/oauth/google", handleMobileGoogleOAuth);
authRouter.post("/mobile/oauth/google", handleMobileGoogleOAuth);

// Alias umum POST /api/auth/login (otomatis mendeteksi web/mobile)
authRouter.post("/login", handleUnifiedLogin);

// US-03 — Register siswa (Mobile: wajib terdaftar di student_roster)
authRouter.post("/mobile/register", handleStudentRegister);
authRouter.post("/register", handleStudentRegister);

// US-06 — Logout (mencabut token aktif di database)
authRouter.post("/logout", authenticate, handleLogout);

// Profil & Pengaturan Sesi Pengguna (US-61 & US-62)
authRouter.get("/me", authenticate, handleGetMe);
authRouter.patch("/profile", authenticate, handleUpdateProfile);
authRouter.put("/password", authenticate, handleChangePassword);
authRouter.get("/sessions", authenticate, handleListSessions);
authRouter.delete("/sessions/:sessionId", authenticate, handleRevokeSession);

export default authRouter;
