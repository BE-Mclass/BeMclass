import fs from "fs";
import path from "path";
import { NextFunction, Request, Response } from "express";
import { AuditService } from "../services/audit.service";
import {
  cancelLeaveRequest,
  createLeaveRequest,
  getLeaveRequestById,
  getLeaveRequestRawRowById,
  listLeaveRequests,
  reviewLeaveRequest,
} from "../services/leave.service";
import { AppError } from "../utils/errors";
import {
  extractLeaveRequestUpload,
  resolveLeaveAttachmentFullPath,
} from "../utils/leave-upload";

function parsePositiveId(raw: unknown, field = "id"): number {
  const str = String(raw ?? "").trim();
  if (!/^\d+$/.test(str)) {
    throw new AppError("ID surat izin tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { [field]: "ID surat izin harus berupa bilangan bulat positif." },
    });
  }
  const id = Number(str);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError("ID surat izin tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { [field]: "ID surat izin harus berupa bilangan bulat positif." },
    });
  }
  return id;
}

function requireStudentRosterId(req: Request): number {
  const user = req.auth?.user;
  if (!user) {
    throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
      code: "UNAUTHENTICATED",
    });
  }
  if (user.role !== "siswa") {
    throw new AppError("Fitur ini hanya tersedia untuk akun siswa.", 403, {
      code: "ROLE_NOT_ALLOWED",
    });
  }
  if (!user.student?.roster_id) {
    throw new AppError("Data profil roster siswa tidak ditemukan.", 404, {
      code: "ROSTER_NOT_FOUND",
    });
  }
  return user.student.roster_id;
}

/**
 * US-20 & FSD §5.5 — POST /api/leave-requests
 */
export async function handleCreateLeaveRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const studentRosterId = requireStudentRosterId(req);
    const parsedUpload = await extractLeaveRequestUpload(req);

    const data = await createLeaveRequest({
      studentRosterId,
      fields: parsedUpload.fields,
      attachment: parsedUpload.attachment,
    });

    res.status(201).json({
      success: true,
      message: "Surat izin berhasil diajukan dan sedang menunggu persetujuan.",
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-20 & US-21, FSD §5.5 — GET /api/leave-requests
 */
export async function handleListLeaveRequests(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.auth?.user;
    if (!user) {
      throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
        code: "UNAUTHENTICATED",
      });
    }

    const result = await listLeaveRequests({
      role: user.role,
      studentRosterId: user.student?.roster_id ?? null,
      filters: {
        status: req.query.status,
        category: req.query.category ?? req.query.type,
        class_id: req.query.class_id ?? req.query.classId,
        nisn: req.query.nisn,
        from: req.query.from ?? req.query.start_date,
        to: req.query.to ?? req.query.end_date,
        page: req.query.page,
        limit: req.query.limit ?? req.query.per_page,
      },
    });

    res.status(200).json({
      success: true,
      data: result.items,
      meta: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-20 & US-21, FSD §5.5 — GET /api/leave-requests/:id
 */
export async function handleGetLeaveRequestById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.auth?.user;
    if (!user) {
      throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
        code: "UNAUTHENTICATED",
      });
    }

    const id = parsePositiveId(req.params.id);
    const data = await getLeaveRequestById({
      id,
      role: user.role,
      studentRosterId: user.student?.roster_id ?? null,
    });

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-21 & FSD §5.5 — GET /api/leave-requests/:id/attachment
 * Stream berkas lampiran surat izin dengan Content-Disposition: inline.
 */
export async function handleGetLeaveAttachment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.auth?.user;
    if (!user) {
      throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
        code: "UNAUTHENTICATED",
      });
    }

    const id = parsePositiveId(req.params.id);
    const row = await getLeaveRequestRawRowById({
      id,
      role: user.role,
      studentRosterId: user.student?.roster_id ?? null,
    });

    const fullPath = resolveLeaveAttachmentFullPath(row.attachment_path);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new AppError("Berkas lampiran surat izin tidak ditemukan di server.", 404, {
        code: "NOT_FOUND",
      });
    }

    const filename = path.basename(fullPath);
    res.setHeader("Content-Type", row.attachment_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, max-age=300");

    const stream = fs.createReadStream(fullPath);
    stream.on("error", (err) => next(err));
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}

/**
 * US-20 & BR-26, FSD §5.5 — PATCH /api/leave-requests/:id/cancel
 */
export async function handleCancelLeaveRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const studentRosterId = requireStudentRosterId(req);
    const id = parsePositiveId(req.params.id);

    const data = await cancelLeaveRequest({
      id,
      studentRosterId,
    });

    res.status(200).json({
      success: true,
      message: "Pengajuan surat izin berhasil dibatalkan.",
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * US-21 & BR-25, FSD §5.5 — PATCH /api/leave-requests/:id/review
 */
export async function handleReviewLeaveRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.auth?.user;
    if (!user) {
      throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
        code: "UNAUTHENTICATED",
      });
    }
    if (user.role !== "admin" && user.role !== "guru") {
      throw new AppError(
        "Akses ditolak. Hanya guru atau admin yang dapat memproses surat izin.",
        403,
        { code: "ROLE_NOT_ALLOWED" }
      );
    }

    const id = parsePositiveId(req.params.id);
    const data = await reviewLeaveRequest({
      id,
      reviewerUserId: user.id,
      payload: req.body,
    });

    await AuditService.logSafe({
      actorUserId: user.id,
      action:
        data.status === "disetujui"
          ? "leave_request.approve"
          : "leave_request.reject",
      entity: "leave_requests",
      entityId: String(data.id),
      meta: {
        student_id: data.student_id,
        nisn: data.student.nisn,
        category: data.category,
        start_date: data.start_date,
        end_date: data.end_date,
        status: data.status,
        review_note: data.review_note,
      },
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message:
        data.status === "disetujui"
          ? "Surat izin berhasil disetujui dan presensi siswa telah diperbarui."
          : "Surat izin telah ditolak.",
      data,
    });
  } catch (error) {
    next(error);
  }
}
