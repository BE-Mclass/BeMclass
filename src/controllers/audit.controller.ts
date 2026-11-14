import { NextFunction, Request, Response } from "express";
import { listAuditLogs } from "../services/audit.service";

/**
 * GET /api/audit-logs
 * Menampilkan daftar audit log aksi sensitif dengan filter & paginasi (khusus Admin — US-70 AC4, FSD §7).
 */
export async function handleListAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await listAuditLogs({
      actor_user_id: req.query.actor_user_id,
      action: req.query.action,
      entity: req.query.entity,
      entity_id: req.query.entity_id,
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
