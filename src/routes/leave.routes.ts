import { Router } from "express";
import {
  handleCancelLeaveRequest,
  handleCreateLeaveRequest,
  handleGetLeaveAttachment,
  handleGetLeaveRequestById,
  handleListLeaveRequests,
  handleReviewLeaveRequest,
} from "../controllers/leave.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const leaveRouter = Router();

leaveRouter.use(authenticate);

// POST /api/leave-requests — Siswa mengajukan surat izin + lampiran PDF/JPG/PNG (🎒 US-20)
leaveRouter.post("/", authorizeRoles("siswa"), handleCreateLeaveRequest);

// GET /api/leave-requests — Daftar surat izin (🔑 Siswa: miliknya; Guru/Admin: semua + filter)
leaveRouter.get("/", handleListLeaveRequests);

// GET /api/leave-requests/:id — Detail surat izin (🔑 US-20/21)
leaveRouter.get("/:id", handleGetLeaveRequestById);

// GET /api/leave-requests/:id/attachment — Stream berkas lampiran (🔑 US-21)
leaveRouter.get("/:id/attachment", handleGetLeaveAttachment);

// PATCH /api/leave-requests/:id/cancel (serta alias POST/PUT) — Siswa batalkan saat 'menunggu' (🎒 US-20)
leaveRouter.patch(
  "/:id/cancel",
  authorizeRoles("siswa"),
  handleCancelLeaveRequest
);
leaveRouter.post(
  "/:id/cancel",
  authorizeRoles("siswa"),
  handleCancelLeaveRequest
);
leaveRouter.put(
  "/:id/cancel",
  authorizeRoles("siswa"),
  handleCancelLeaveRequest
);

// PATCH /api/leave-requests/:id/review (serta alias POST/PUT) — Guru/Admin setujui/tolak (👩‍🏫 US-21)
leaveRouter.patch(
  "/:id/review",
  authorizeRoles("admin", "guru"),
  handleReviewLeaveRequest
);
leaveRouter.post(
  "/:id/review",
  authorizeRoles("admin", "guru"),
  handleReviewLeaveRequest
);
leaveRouter.put(
  "/:id/review",
  authorizeRoles("admin", "guru"),
  handleReviewLeaveRequest
);

export default leaveRouter;
