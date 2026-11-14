import { Router } from "express";
import {
  handleListDevices,
  handleRegisterDevice,
  handleUnregisterDevice,
} from "../controllers/device.controller";
import { authenticate } from "../middleware/auth.middleware";

const deviceRouter = Router();

// Seluruh endpoint perangkat membutuhkan autentikasi (🔑 M-PUSH, FSD §5.9)
deviceRouter.use(authenticate);

// POST /api/devices (serta alias PUT/PATCH) — Daftar / perbarui token FCM Push Notification
deviceRouter.post("/", handleRegisterDevice);
deviceRouter.put("/", handleRegisterDevice);
deviceRouter.patch("/", handleRegisterDevice);

// GET /api/devices — Daftar token perangkat milik pengguna
deviceRouter.get("/", handleListDevices);

// DELETE /api/devices/:token & DELETE /api/devices — Hapus token perangkat milik pengguna
deviceRouter.delete("/:token", handleUnregisterDevice);
deviceRouter.delete("/", handleUnregisterDevice);

export default deviceRouter;
