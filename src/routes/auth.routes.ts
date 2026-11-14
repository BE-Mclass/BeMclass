import { Router } from "express";
import {
  handleChangePassword,
  handleDeleteAvatar,
  handleForgotPassword,
  handleGetMe,
  handleListSessions,
  handleLogout,
  handleMobileGoogleOAuth,
  handleMobileLogin,
  handleResetPassword,
  handleRevokeSession,
  handleStudentRegister,
  handleUnifiedLogin,
  handleUpdateProfile,
  handleUploadAvatar,
  handleVerifyOtp,
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

// US-05 — Lupa Kata Sandi Siswa via OTP Email (Mobile, 3 langkah: BR-06 & BR-07)
authRouter.post("/forgot-password", handleForgotPassword);
authRouter.post("/mobile/forgot-password", handleForgotPassword);
authRouter.post("/verify-otp", handleVerifyOtp);
authRouter.post("/mobile/verify-otp", handleVerifyOtp);
authRouter.post("/reset-password", handleResetPassword);
authRouter.post("/mobile/reset-password", handleResetPassword);

// US-06 — Logout (mencabut token aktif di database)
authRouter.post("/logout", authenticate, handleLogout);

// Profil & Pengaturan Sesi Pengguna (US-61 & US-62)
authRouter.get("/me", authenticate, handleGetMe);
authRouter.patch("/me", authenticate, handleUpdateProfile);
authRouter.put("/me", authenticate, handleUpdateProfile);
authRouter.patch("/profile", authenticate, handleUpdateProfile);
authRouter.put("/profile", authenticate, handleUpdateProfile);

// Ganti Sandi (US-62 AC3)
authRouter.put("/me/password", authenticate, handleChangePassword);
authRouter.patch("/me/password", authenticate, handleChangePassword);
authRouter.put("/password", authenticate, handleChangePassword);
authRouter.patch("/password", authenticate, handleChangePassword);

// Foto Profil / Avatar (US-62 AC2)
authRouter.post("/me/avatar", authenticate, handleUploadAvatar);
authRouter.delete("/me/avatar", authenticate, handleDeleteAvatar);
authRouter.post("/avatar", authenticate, handleUploadAvatar);
authRouter.delete("/avatar", authenticate, handleDeleteAvatar);

// Log Sesi Terakhir (US-62 AC4)
authRouter.get("/sessions", authenticate, handleListSessions);
authRouter.delete("/sessions/:sessionId", authenticate, handleRevokeSession);

export default authRouter;
