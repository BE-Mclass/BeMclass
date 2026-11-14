import { Router } from "express";
import {
  handleListJobRuns,
  handleTriggerJob,
} from "../controllers/job.controller";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const jobRouter = Router();

jobRouter.use(authenticate, authorizeRoles("admin"));

// Riwayat eksekusi job (job_runs)
jobRouter.get("/", handleListJobRuns);
jobRouter.get("/runs", handleListJobRuns);

// Eksekusi manual / uji job (alpa, alpa-catchup, cleanup-auth)
jobRouter.post("/run", handleTriggerJob);
jobRouter.post("/run/:jobName", handleTriggerJob);

export default jobRouter;
