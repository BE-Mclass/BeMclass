import { Request, Response, NextFunction } from "express";
import {
  createStudentRoster,
  deleteStudentRoster,
  listStudentRoster,
  updateStudentRoster,
} from "../services/roster.service";

export async function handleListRoster(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const classId = req.query.class_id ? Number(req.query.class_id) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;

    const data = await listStudentRoster({ classId, search });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleCreateRoster(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body ?? {};
    const created = await createStudentRoster({
      nisn: body.nisn,
      fullName: body.full_name ?? body.fullName ?? body.name,
      classId: body.class_id ?? body.classId ?? null,
      attendanceNumber: body.attendance_number ?? body.attendanceNumber ?? null,
      parentPhone: body.parent_phone ?? body.parentPhone ?? null,
      whatsappNumber: body.whatsapp_number ?? body.whatsappNumber ?? null,
      address: body.address ?? null,
    });

    res.status(201).json({
      success: true,
      message: "Data roster siswa berhasil ditambahkan.",
      data: created,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleUpdateRoster(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = Number(req.params.id);
    const body = req.body ?? {};

    const updated = await updateStudentRoster(id, {
      nisn: body.nisn,
      fullName: body.full_name ?? body.fullName ?? body.name,
      classId: body.class_id ?? body.classId,
      attendanceNumber: body.attendance_number ?? body.attendanceNumber,
      parentPhone: body.parent_phone ?? body.parentPhone,
      whatsappNumber: body.whatsapp_number ?? body.whatsappNumber,
      address: body.address,
      isActive: body.is_active ?? body.isActive,
    });

    res.status(200).json({
      success: true,
      message: "Data roster siswa berhasil diperbarui.",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleDeleteRoster(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = Number(req.params.id);
    await deleteStudentRoster(id);

    res.status(200).json({
      success: true,
      message: "Data roster siswa berhasil dihapus.",
    });
  } catch (error) {
    next(error);
  }
}
