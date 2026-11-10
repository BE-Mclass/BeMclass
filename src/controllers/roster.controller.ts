import { Request, Response, NextFunction } from "express";
import {
  createStudentRoster,
  deleteStudentRoster,
  listStudentRoster,
  updateStudentRoster,
} from "../services/roster.service";
import { AppError } from "../utils/errors";

function parseId(value: unknown, field: string): number {
  if (typeof value !== "string") {
    throw new AppError("ID roster siswa tidak valid.", 400, {
      code: "INVALID_ID",
      errors: { [field]: "ID harus berupa bilangan bulat positif." },
    });
  }
  if (!/^\d+$/.test(value)) {
    throw new AppError("ID roster siswa tidak valid.", 400, {
      code: "INVALID_ID",
      errors: { [field]: "ID harus berupa bilangan bulat positif." },
    });
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError("ID roster siswa tidak valid.", 400, {
      code: "INVALID_ID",
      errors: { [field]: "ID harus berupa bilangan bulat positif." },
    });
  }
  return id;
}

function readBodyField(body: unknown, ...keys: string[]): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return (body as Record<string, unknown>)[key];
    }
  }
  return undefined;
}

export async function handleListRoster(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawClassId = req.query.class_id;
    const classId =
      rawClassId === undefined
        ? undefined
        : parseId(
            typeof rawClassId === "string" ? rawClassId : "",
            "class_id"
          );
    const rawSearch = req.query.search;
    if (rawSearch !== undefined && typeof rawSearch !== "string") {
      throw new AppError("Parameter pencarian tidak valid.", 400, {
        code: "VALIDATION_ERROR",
        errors: { search: "Pencarian harus berupa teks." },
      });
    }
    const search = rawSearch?.trim() || undefined;

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
      nisn: readBodyField(body, "nisn"),
      fullName: readBodyField(body, "full_name", "fullName", "name"),
      classId: readBodyField(body, "class_id", "classId"),
      attendanceNumber: readBodyField(
        body,
        "attendance_number",
        "attendanceNumber"
      ),
      parentPhone: readBodyField(body, "parent_phone", "parentPhone"),
      whatsappNumber: readBodyField(
        body,
        "whatsapp_number",
        "whatsappNumber"
      ),
      address: readBodyField(body, "address"),
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
    const id = parseId(req.params.id, "id");
    const body = req.body ?? {};

    const updated = await updateStudentRoster(id, {
      nisn: readBodyField(body, "nisn"),
      fullName: readBodyField(body, "full_name", "fullName", "name"),
      classId: readBodyField(body, "class_id", "classId"),
      attendanceNumber: readBodyField(
        body,
        "attendance_number",
        "attendanceNumber"
      ),
      parentPhone: readBodyField(body, "parent_phone", "parentPhone"),
      whatsappNumber: readBodyField(
        body,
        "whatsapp_number",
        "whatsappNumber"
      ),
      address: readBodyField(body, "address"),
      isActive: readBodyField(body, "is_active", "isActive"),
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
    const id = parseId(req.params.id, "id");
    await deleteStudentRoster(id);

    res.status(200).json({
      success: true,
      message: "Data roster siswa berhasil dihapus.",
    });
  } catch (error) {
    next(error);
  }
}
