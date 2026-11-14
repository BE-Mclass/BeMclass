import { Router } from "express";
import { handleListAuditLogs } from "../controllers/audit.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const auditRouter = Router();

auditRouter.use(authenticate, authorizeRoles("admin"));

auditRouter.get("/", handleListAuditLogs);

export default auditRouter;
