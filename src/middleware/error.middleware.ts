import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";

export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`,
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const responseBody: Record<string, unknown> = {
      success: false,
      message: err.message,
    };

    if (err.code) {
      responseBody.code = err.code;
    }
    if (err.errors) {
      responseBody.errors = err.errors;
    }

    res.status(err.statusCode).json(responseBody);
    return;
  }

  console.error("[Unhandled Error]:", err);
  res.status(500).json({
    success: false,
    message: "Terjadi kesalahan pada server.",
  });
}
