import { Router } from "express";
import {
  handleGetUnreadCount,
  handleListNotifications,
  handleMarkAllNotificationsRead,
  handleMarkNotificationRead,
} from "../controllers/notification.controller";
import { authenticate } from "../middleware/auth.middleware";

const notificationRouter = Router();

// Seluruh endpoint notifikasi membutuhkan autentikasi (🔑 US-60, FSD §5.9)
notificationRouter.use(authenticate);

// GET /api/notifications?unread=&type=&page= — Daftar notifikasi milik pengguna
notificationRouter.get("/", handleListNotifications);

// GET /api/notifications/unread-count — Jumlah notifikasi belum dibaca untuk badge UI
notificationRouter.get("/unread-count", handleGetUnreadCount);

// POST /api/notifications/read-all (serta alias PATCH/PUT) — Tandai semua sudah dibaca
notificationRouter.post("/read-all", handleMarkAllNotificationsRead);
notificationRouter.patch("/read-all", handleMarkAllNotificationsRead);
notificationRouter.put("/read-all", handleMarkAllNotificationsRead);

// PATCH /api/notifications/:id/read (serta alias PUT/POST) — Tandai satu notifikasi sudah dibaca
notificationRouter.patch("/:id/read", handleMarkNotificationRead);
notificationRouter.put("/:id/read", handleMarkNotificationRead);
notificationRouter.post("/:id/read", handleMarkNotificationRead);

export default notificationRouter;
