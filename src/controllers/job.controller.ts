import { NextFunction, Request, Response } from "express";
import { AuditService } from "../services/audit.service";
import {
  listJobRuns,
  runAlpaCatchupJob,
  runAutoAlpaJob,
  runCleanupAuthJob,
} from "../services/job.service";
import { AppError } from "../utils/errors";

/**
 * GET /api/jobs/runs (alias GET /api/jobs)
 * Menampilkan riwayat eksekusi job terjadwal dari tabel `job_runs` (khusus Admin — TRD §8).
 */
export async function handleListJobRuns(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await listJobRuns({
      job_name: req.query.job_name,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      limit: req.query.limit,
    });

    res.status(200).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/jobs/run/:jobName (alias POST /api/jobs/run)
 * Menjalankan job (`alpa`, `alpa-catchup`, `cleanup-auth`) secara idempoten dan mencatatnya ke `job_runs`.
 */
export async function handleTriggerJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const paramJob = req.params.jobName;
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const rawJobName =
      typeof paramJob === "string" && paramJob !== ":jobName"
        ? paramJob
        : typeof body.job_name === "string"
          ? body.job_name
          : typeof body.jobName === "string"
            ? body.jobName
            : "";

    const jobName = rawJobName.trim().toLowerCase();
    const runDate =
      typeof body.run_date === "string" && body.run_date.trim() !== ""
        ? body.run_date.trim()
        : typeof body.date === "string" && body.date.trim() !== ""
          ? body.date.trim()
          : undefined;
    const force = Boolean(body.force);
    const bypassTimeCheck =
      body.bypass_time_check !== undefined
        ? Boolean(body.bypass_time_check)
        : true;

    let result;
    if (jobName === "alpa") {
      result = await runAutoAlpaJob(runDate, {
        force,
        bypassTimeCheck,
      });
    } else if (jobName === "alpa-catchup") {
      const daysBack =
        typeof body.days_back === "number" ? body.days_back : undefined;
      result = await runAlpaCatchupJob({ daysBack, force });
    } else if (jobName === "cleanup-auth") {
      result = await runCleanupAuthJob({ runDate, force });
    } else {
      throw new AppError(
        "Nama job tidak dikenali. Gunakan 'alpa', 'alpa-catchup', atau 'cleanup-auth'.",
        400,
        {
          code: "VALIDATION_ERROR",
          errors: {
            job_name:
              "Pilihan job yang didukung: alpa, alpa-catchup, cleanup-auth.",
          },
        }
      );
    }

    await AuditService.logSafe({
      actorUserId: req.auth?.user.id ?? null,
      action: "job.manual_trigger",
      entity: "job_runs",
      entityId: result.job_run?.id ?? result.job_name,
      meta: {
        job_name: result.job_name,
        run_date: result.run_date,
        status: result.status,
        affected: result.affected,
        force,
      },
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message:
        result.status === "completed"
          ? `Job '${result.job_name}' berhasil dijalankan (${result.affected} data diproses).`
          : `Job '${result.job_name}' dilewati (${result.reason ?? "SKIPPED"}).`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
