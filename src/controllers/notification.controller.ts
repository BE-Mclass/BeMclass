import { NextFunction, Request, Response } from "express";
import {
  getUnreadNotificationCount,
  listUserNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../services/notification.service";
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
 * US-60 & FSD §5.9 — GET /api/notifications?unread=&type=&page=
 */
export async function handleListNotifications(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const result = await listUserNotifications(userId, {
      unread: req.query.unread,
      type: req.query.type,
      page: req.query.page,
      perPage: req.query.per_page ?? req.query.perPage ?? req.query.limit,
    });

    res.status(200).json({
      success: true,
      data: result.items,
      unread_count: result.unread_count,
      meta: {
        unread_count: result.unread_count,
        ...result.pagination,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-60 AC2 & FSD §5.9 — GET /api/notifications/unread-count
 */
export async function handleGetUnreadCount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const data = await getUnreadNotificationCount(userId);
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-60 & FSD §5.9 — PATCH /api/notifications/:id/read
 */
export async function handleMarkNotificationRead(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const rawId = String(req.params.id ?? "").trim();
    if (!/^\d+$/.test(rawId)) {
      throw new AppError("ID notifikasi tidak valid.", 400, {
        code: "VALIDATION_ERROR",
        errors: { id: "ID notifikasi harus berupa bilangan bulat positif." },
      });
    }
    const notificationId = Number(rawId);

    const data = await markNotificationAsRead(userId, notificationId);
    res.status(200).json({
      success: true,
      message: "Notifikasi ditandai sudah dibaca.",
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-60 AC1 & FSD §5.9 — POST /api/notifications/read-all
 */
export async function handleMarkAllNotificationsRead(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const data = await markAllNotificationsAsRead(userId);
    res.status(200).json({
      success: true,
      message: "Semua notifikasi berhasil ditandai sudah dibaca.",
      data,
    });
  } catch (error) {
    next(error);
  }
}
