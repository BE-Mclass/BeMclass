import { Request, Response, NextFunction } from "express";
import { AuditService } from "../services/audit.service";
import {
  changePassword,
  deleteUserAvatar,
  listUserSessions,
  loginMobile,
  loginStudentGoogleOAuth,
  loginWeb,
  logoutSession,
  registerStudent,
  updateProfile,
  updateUserAvatar,
} from "../services/auth.service";
import {
  completePasswordReset,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
} from "../services/password-reset.service";
import { extractAvatarUpload } from "../utils/avatar-upload";
import { AppError } from "../utils/errors";

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? "";
}

/**
 * POST /api/auth/web/login
 * US-01 — Admin/Guru login (Web)
 */
export async function handleWebLogin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, identity, password, remember_me, rememberMe } = req.body ?? {};
    const loginEmail = email ?? identity ?? "";

    const result = await loginWeb({
      email: loginEmail,
      password,
      rememberMe: remember_me ?? rememberMe,
      userAgent: req.headers["user-agent"],
      ipAddress: getClientIp(req),
    });

    await AuditService.logSafe({
      actorUserId: result.user.id,
      action: "auth.staff_login.success",
      entity: "users",
      entityId: result.user.id,
      meta: {
        email: result.user.email,
        role: result.user.role,
      },
      ip: getClientIp(req),
    });

    res.status(200).json({
      success: true,
      message: "Login berhasil.",
      token: result.token,
      user: result.user,
      data: result,
    });
  } catch (error) {
    await AuditService.logSafe({
      actorUserId: null,
      action: "auth.staff_login.failed",
      entity: "users",
      meta: {
        email: String(req.body?.email ?? req.body?.identity ?? ""),
      },
      ip: getClientIp(req),
    });
    next(error);
  }
}

/**
 * POST /api/auth/mobile/login
 * US-02 — Siswa login (Mobile) menggunakan email atau NISN 10 digit
 */
export async function handleMobileLogin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { identifier, email, nisn, password } = req.body ?? {};
    const loginIdentifier = identifier ?? email ?? nisn ?? "";

    const result = await loginMobile({
      identifier: loginIdentifier,
      password,
      userAgent: req.headers["user-agent"],
      ipAddress: getClientIp(req),
    });

    res.status(200).json({
      success: true,
      message: "Login berhasil.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/oauth/google & POST /api/auth/mobile/oauth/google
 * US-02B & BR-09B — Siswa login menggunakan Google OAuth di tampilan Mobile
 */
export async function handleMobileGoogleOAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id_token, idToken, credential, nisn } = req.body ?? {};

    const result = await loginStudentGoogleOAuth({
      idToken: id_token ?? idToken ?? credential ?? "",
      nisn,
      userAgent: req.headers["user-agent"],
      ipAddress: getClientIp(req),
    });

    res.status(200).json({
      success: true,
      message: "Login Google berhasil.",
      token: result.token,
      user: result.user,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/login
 * Endpoint umum yang mengarahkan ke Web Login atau Mobile Login berdasarkan client_type / payload
 */
export async function handleUnifiedLogin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const clientType = req.body?.client_type ?? req.headers["x-client-type"];
  if (
    clientType === "mobile" ||
    req.body?.nisn !== undefined ||
    req.body?.identifier !== undefined
  ) {
    return handleMobileLogin(req, res, next);
  }
  return handleWebLogin(req, res, next);
}

/**
 * POST /api/auth/mobile/register & POST /api/auth/register
 * US-03 — Register siswa (Mobile)
 */
export async function handleStudentRegister(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      name,
      nisn,
      email,
      password,
      password_confirmation,
      passwordConfirmation,
    } = req.body ?? {};

    const registeredUser = await registerStudent({
      name,
      nisn,
      email,
      password,
      passwordConfirmation: password_confirmation ?? passwordConfirmation ?? "",
    });

    res.status(201).json({
      success: true,
      message: "Registrasi siswa berhasil. Silakan masuk menggunakan akun Anda.",
      data: registeredUser,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/logout
 * US-06 — Logout (mencabut sesi token di server)
 */
export async function handleLogout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      throw new AppError("Sesi tidak ditemukan.", 401);
    }

    await logoutSession(req.auth.sessionId, req.auth.user.id);

    res.status(200).json({
      success: true,
      message: "Logout berhasil. Sesi Anda telah diakhiri.",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/me
 * Mendapatkan data user yang sedang login
 */
export async function handleGetMe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      throw new AppError("Sesi tidak ditemukan.", 401);
    }

    res.status(200).json({
      success: true,
      data: req.auth.user,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/auth/profile & PATCH /api/auth/me
 * US-61 & US-62 — Memperbarui profil akun yang sedang login (termasuk kata sandi baru opsional pada form profil web)
 */
export async function handleUpdateProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      throw new AppError("Sesi tidak ditemukan.", 401);
    }

    const updatedUser = await updateProfile(
      req.auth.user,
      req.body ?? {},
      req.auth.sessionId
    );

    res.status(200).json({
      success: true,
      message: "Profil berhasil diperbarui.",
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/me/avatar & POST /api/auth/avatar
 * US-62 AC2 — Mengunggah / mengganti foto profil (JPG/PNG/WebP)
 */
export async function handleUploadAvatar(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      throw new AppError("Sesi tidak ditemukan.", 401);
    }

    const { buffer, ext } = await extractAvatarUpload(req);
    const result = await updateUserAvatar(req.auth.user.id, buffer, ext);

    res.status(200).json({
      success: true,
      message: "Foto profil berhasil diperbarui.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/auth/me/avatar & DELETE /api/auth/avatar
 * US-62 AC2 — Menghapus foto profil
 */
export async function handleDeleteAvatar(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      throw new AppError("Sesi tidak ditemukan.", 401);
    }

    await deleteUserAvatar(req.auth.user.id);

    res.status(200).json({
      success: true,
      message: "Foto profil berhasil dihapus.",
      data: {
        photo_url: null,
        avatar_url: null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/auth/password
 * US-62 AC3 — Mengganti kata sandi & mencabut sesi lain
 */
export async function handleChangePassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      throw new AppError("Sesi tidak ditemukan.", 401);
    }

    const {
      current_password,
      currentPassword,
      new_password,
      newPassword,
      new_password_confirmation,
      newPasswordConfirmation,
    } = req.body ?? {};

    await changePassword({
      userId: req.auth.user.id,
      currentSessionId: req.auth.sessionId,
      currentPassword: current_password ?? currentPassword ?? "",
      newPassword: new_password ?? newPassword ?? "",
      newPasswordConfirmation:
        new_password_confirmation ?? newPasswordConfirmation ?? "",
    });

    res.status(200).json({
      success: true,
      message:
        "Kata sandi berhasil diperbarui. Seluruh sesi pada perangkat lain telah dicabut.",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/sessions
 * US-62 AC4 — Log sesi aktif pengguna
 */
export async function handleListSessions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      throw new AppError("Sesi tidak ditemukan.", 401);
    }

    const sessions = await listUserSessions(
      req.auth.user.id,
      req.auth.sessionId
    );

    res.status(200).json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/auth/sessions/:sessionId
 * Mencabut satu sesi tertentu milik pengguna
 */
export async function handleRevokeSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      throw new AppError("Sesi tidak ditemukan.", 401);
    }

    const sessionId = String(req.params.sessionId ?? "");
    if (!sessionId) {
      throw new AppError("ID sesi wajib disertakan.", 400);
    }

    await logoutSession(sessionId, req.auth.user.id);

    res.status(200).json({
      success: true,
      message: "Sesi berhasil dicabut.",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/forgot-password
 * US-05 & BR-06 — Langkah 1 Lupa Sandi Siswa: Kirim OTP 6 digit ke email siswa
 */
export async function handleForgotPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, identifier } = req.body ?? {};
    const data = await requestPasswordResetOtp({
      email: email ?? identifier,
    });

    res.status(200).json({
      success: true,
      message: data.message,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/verify-otp
 * US-05, BR-06 & BR-07 — Langkah 2 Lupa Sandi Siswa: Verifikasi OTP -> keluarkan reset_token
 */
export async function handleVerifyOtp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, otp, code } = req.body ?? {};
    const result = await verifyPasswordResetOtp({
      email,
      otp: otp ?? code,
    });

    res.status(200).json({
      success: true,
      message: "Kode OTP berhasil diverifikasi.",
      data: {
        reset_token: result.reset_token,
        expires_in: result.expires_in,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/reset-password
 * US-05, BR-05 & BR-07 — Langkah 3 Lupa Sandi Siswa: Ganti sandi dengan reset_token & cabut semua sesi
 */
export async function handleResetPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      reset_token,
      resetToken,
      token,
      new_password,
      newPassword,
      password,
      password_confirmation,
      passwordConfirmation,
    } = req.body ?? {};

    const result = await completePasswordReset({
      resetToken: reset_token ?? resetToken ?? token,
      newPassword: new_password ?? newPassword ?? password,
      passwordConfirmation: password_confirmation ?? passwordConfirmation,
    });

    await AuditService.logSafe({
      actorUserId: result.userId,
      action: "auth.password_reset.completed",
      entity: "users",
      entityId: String(result.userId),
      meta: { method: "email_otp" },
      ip: getClientIp(req),
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        message: result.message,
      },
    });
  } catch (error) {
    next(error);
  }
}
