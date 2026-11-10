import { NextFunction, Request, Response } from "express";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from "../services/announcement.service";
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

export async function handleListAnnouncements(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await listAnnouncements(userRole(req));
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
    const data = await getAnnouncement(parseId(req.params.id), userRole(req));
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
    const data = await updateAnnouncement(parseId(req.params.id), req.body);
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
    await deleteAnnouncement(parseId(req.params.id));
    res.status(200).json({
      success: true,
      message: "Pengumuman berhasil dihapus.",
    });
  } catch (error) {
    next(error);
  }
}
