import { Request, Response, NextFunction } from "express";
import { verifyActiveSession } from "../services/auth.service";
import { UserRole } from "../types/auth.types";
import { AppError } from "../utils/errors";
import { verifyAccessToken } from "../utils/jwt";

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("Sesi tidak valid atau belum masuk.", 401, {
        code: "UNAUTHORIZED",
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError("Token autentikasi tidak ditemukan.", 401, {
        code: "UNAUTHORIZED",
      });
    }

    const payload = verifyAccessToken(token);
    if (!payload) {
      throw new AppError("Token tidak valid atau telah kedaluwarsa.", 401, {
        code: "INVALID_TOKEN",
      });
    }

    // US-01 AC6, US-04 AC2, US-06 AC:
    // Pastikan sesi belum dicabut & akun masih aktif di database
    const activeUser = await verifyActiveSession(payload.jti, payload.sub);
    if (!activeUser) {
      throw new AppError(
        "Sesi telah berakhir, dicabut, atau akun sudah tidak aktif.",
        401,
        { code: "SESSION_REVOKED_OR_INACTIVE" }
      );
    }

    req.auth = {
      user: activeUser,
      sessionId: payload.jti,
      clientType: payload.client_type,
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function authorizeRoles(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(
        new AppError("Sesi tidak valid atau belum masuk.", 401, {
          code: "UNAUTHORIZED",
        })
      );
      return;
    }

    if (!allowedRoles.includes(req.auth.user.role)) {
      next(
        new AppError("Akses ditolak", 403, {
          code: "FORBIDDEN",
        })
      );
      return;
    }

    next();
  };
}
