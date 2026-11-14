import { Router } from "express";
import {
  handleCreateAnnouncement,
  handleDeleteAnnouncement,
  handleGetAnnouncement,
  handleListAnnouncements,
  handleUpdateAnnouncement,
} from "../controllers/announcement.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const announcementRouter = Router();

announcementRouter.use(authenticate);

announcementRouter.get("/", handleListAnnouncements);
announcementRouter.get("/:id", handleGetAnnouncement);
announcementRouter.post(
  "/",
  authorizeRoles("admin", "guru"),
  handleCreateAnnouncement
);
announcementRouter.put(
  "/:id",
  authorizeRoles("admin", "guru"),
  handleUpdateAnnouncement
);
announcementRouter.patch(
  "/:id",
  authorizeRoles("admin", "guru"),
  handleUpdateAnnouncement
);
announcementRouter.delete(
  "/:id",
  authorizeRoles("admin", "guru"),
  handleDeleteAnnouncement
);

export default announcementRouter;
