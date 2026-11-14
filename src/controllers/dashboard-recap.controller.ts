import { NextFunction, Request, Response } from "express";
import {
  getDashboardSummary,
  getRecapClassDetail,
  getRecapClasses,
  getRecapLocation,
  getRecapOverview,
} from "../services/dashboard-recap.service";
import { AppError } from "../utils/errors";

function ensureStaffRole(req: Request): void {
  const user = req.auth?.user;
  if (!user) {
    throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
      code: "UNAUTHENTICATED",
    });
  }
  if (user.role !== "admin" && user.role !== "guru") {
    throw new AppError("Akses ditolak.", 403, {
      code: "ROLE_NOT_ALLOWED",
    });
  }
}

/**
 * US-40, BR-30..32 & FSD §5.6 — GET /api/dashboard/summary?date=
 */
export async function handleGetDashboardSummary(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    ensureStaffRole(req);
    const data = await getDashboardSummary({
      date: req.query.date,
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
 * US-41, BR-31..35 & FSD §5.6 — GET /api/recap/overview?from=&to=
 */
export async function handleGetRecapOverview(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    ensureStaffRole(req);
    const data = await getRecapOverview({
      from: req.query.from,
      to: req.query.to,
      date: req.query.date,
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
 * US-41, BR-31..32 & FSD §5.6 — GET /api/recap/classes?from=&to=
 */
export async function handleGetRecapClasses(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    ensureStaffRole(req);
    const data = await getRecapClasses({
      from: req.query.from,
      to: req.query.to,
      date: req.query.date,
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
 * US-41 & FSD §5.6 — GET /api/recap/classes/:classId?date=&q=&status=
 */
export async function handleGetRecapClassDetail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    ensureStaffRole(req);
    const rawClassId = String(req.params.classId ?? "").trim();
    if (!/^\d+$/.test(rawClassId)) {
      throw new AppError("ID kelas tidak valid.", 400, {
        code: "VALIDATION_ERROR",
        errors: { classId: "ID kelas harus berupa bilangan bulat positif." },
      });
    }

    const data = await getRecapClassDetail({
      classId: Number(rawClassId),
      date: req.query.date,
      q: req.query.q,
      status: req.query.status,
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
 * US-43, BR-33 & FSD §5.6 — GET /api/recap/location?date=
 */
export async function handleGetRecapLocation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    ensureStaffRole(req);
    const data = await getRecapLocation({
      date: req.query.date,
    });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}
