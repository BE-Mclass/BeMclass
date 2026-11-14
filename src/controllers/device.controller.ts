import { NextFunction, Request, Response } from "express";
import {
  listUserDeviceTokens,
  registerDeviceToken,
  unregisterDeviceToken,
} from "../services/device.service";
import { AppError } from "../utils/errors";

function requireUserId(req: Request): number {
  const userId = req.auth?.user?.id;
  if (!userId) {
    throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
      code: "UNAUTHENTICATED",
    });
  }
  return userId;
}

/**
 * M-PUSH & FSD §5.9 (P1) — POST /api/devices
 * Mendaftarkan atau memperbarui token FCM perangkat milik pengguna yang sedang login.
 */
export async function handleRegisterDevice(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const data = await registerDeviceToken(userId, req.body);

    res.status(201).json({
      success: true,
      message: "Token FCM perangkat berhasil didaftarkan.",
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/devices
 * Menampilkan daftar token perangkat terdaftar milik pengguna saat ini.
 */
export async function handleListDevices(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const data = await listUserDeviceTokens(userId);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/devices/:token (atau DELETE /api/devices dengan body `{ token }`)
 * Menghapus token perangkat milik pengguna saat ini.
 */
export async function handleUnregisterDevice(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};
    const rawTokenOrId =
      req.params.token ??
      body.token ??
      body.fcm_token ??
      body.device_token ??
      req.query.token;

    const data = await unregisterDeviceToken(userId, rawTokenOrId);

    res.status(200).json({
      success: true,
      message: "Token FCM perangkat berhasil dihapus.",
      data,
    });
  } catch (error) {
    next(error);
  }
}
