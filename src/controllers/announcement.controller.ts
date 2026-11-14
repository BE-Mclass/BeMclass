import { NextFunction, Request, Response } from "express";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from "../services/announcement.service";
import { AuditService } from "../services/audit.service";
import { UserRole } from "../types/auth.types";
import { AppError } from "../utils/errors";

function getAuthenticatedUser(req: Request) {
  if (!req.auth) {
    throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
      code: "UNAUTHORIZED",
    });
  }
  return req.auth.user;
}

function parseId(value: unknown): number {
  if (typeof value !== "string") {
    throw new AppError("ID pengumuman tidak valid.", 400, {
      code: "INVALID_ID",
      errors: { id: "ID harus berupa bilangan bulat positif." },
    });
  }
  if (!/^\d+$/.test(value)) {
    throw new AppError("ID pengumuman tidak valid.", 400, {
      code: "INVALID_ID",
      errors: { id: "ID harus berupa bilangan bulat positif." },
    });
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError("ID pengumuman tidak valid.", 400, {
      code: "INVALID_ID",
      errors: { id: "ID harus berupa bilangan bulat positif." },
    });
  }
  return id;
}

function userRole(req: Request): UserRole {
  return getAuthenticatedUser(req).role;
}

function studentClassId(req: Request): number | null {
  return getAuthenticatedUser(req).student?.class_id ?? null;
}

export async function handleListAnnouncements(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await listAnnouncements(userRole(req), studentClassId(req), {
      type: req.query.type,
      category: req.query.category,
      audience: req.query.audience,
      target_audience: req.query.target_audience,
      priority: req.query.priority,
      status: req.query.status,
      class_id: req.query.class_id,
      from: req.query.from,
      to: req.query.to,
      q: req.query.q ?? req.query.search,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function handleGetAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getAnnouncement(
      parseId(req.params.id),
      userRole(req),
      studentClassId(req)
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function handleCreateAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = getAuthenticatedUser(req);
    const data = await createAnnouncement(req.body, user.id);
    await AuditService.logSafe({
      actorUserId: user.id,
      action: "announcement.create",
      entity: "announcements",
      entityId: data.id,
      meta: {
        title: data.title,
        type: data.type,
        audience: data.audience,
        priority: data.priority,
        status: data.status,
      },
      ip: req.ip,
    });
    res.status(201).json({
      success: true,
      message: "Pengumuman berhasil dibuat.",
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleUpdateAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = getAuthenticatedUser(req);
    const id = parseId(req.params.id);
    const data = await updateAnnouncement(id, req.body);
    await AuditService.logSafe({
      actorUserId: user.id,
      action: "announcement.update",
      entity: "announcements",
      entityId: id,
      meta: {
        title: data.title,
        type: data.type,
        audience: data.audience,
        priority: data.priority,
        status: data.status,
      },
      ip: req.ip,
    });
    res.status(200).json({
      success: true,
      message: "Pengumuman berhasil diperbarui.",
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleDeleteAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = getAuthenticatedUser(req);
    const id = parseId(req.params.id);
    await deleteAnnouncement(id);
    await AuditService.logSafe({
      actorUserId: user.id,
      action: "announcement.delete",
      entity: "announcements",
      entityId: id,
      ip: req.ip,
    });
    res.status(200).json({
      success: true,
      message: "Pengumuman berhasil dihapus.",
    });
  } catch (error) {
    next(error);
  }
}
