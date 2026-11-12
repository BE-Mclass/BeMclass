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
    if (err.details) {
      responseBody.details = err.details;
    }

    res.status(err.statusCode).json(responseBody);
    return;
  }

  if (typeof err === "object" && err !== null) {
    const requestError = err as { type?: unknown };
    if (requestError.type === "entity.parse.failed") {
      res.status(400).json({
        success: false,
        message: "Format JSON pada permintaan tidak valid.",
        code: "INVALID_JSON",
      });
      return;
    }
    if (requestError.type === "entity.too.large") {
      res.status(413).json({
        success: false,
        message: "Ukuran data permintaan melebihi batas.",
        code: "PAYLOAD_TOO_LARGE",
      });
      return;
    }
  }

  console.error("[Unhandled Error]:", err);
  res.status(500).json({
    success: false,
    message: "Terjadi kesalahan pada server.",
  });
}
