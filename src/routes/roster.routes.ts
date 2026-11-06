import { Router } from "express";
import {
  handleCreateRoster,
  handleDeleteRoster,
  handleListRoster,
  handleUpdateRoster,
} from "../controllers/roster.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const rosterRouter = Router();

// Hanya admin dan guru yang dapat melihat/mengelola roster siswa
rosterRouter.use(authenticate, authorizeRoles("admin", "guru"));

rosterRouter.get("/", handleListRoster);
rosterRouter.post("/", handleCreateRoster);
rosterRouter.put("/:id", handleUpdateRoster);
rosterRouter.delete("/:id", handleDeleteRoster);

export default rosterRouter;
