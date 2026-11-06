import { Request, Response, NextFunction } from "express";
import {
  changePassword,
  listUserSessions,
  loginMobile,
  loginWeb,
  logoutSession,
  registerStudent,
  updateProfile,
} from "../services/auth.service";
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
    const { email, password, remember_me, rememberMe } = req.body ?? {};

    const result = await loginWeb({
      email,
      password,
      rememberMe: Boolean(remember_me ?? rememberMe),
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
      identifier: String(loginIdentifier),
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
 * PATCH /api/auth/profile
 * US-61 & US-62 — Memperbarui profil akun yang sedang login
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

    const updatedUser = await updateProfile(req.auth.user, req.body ?? {});

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
