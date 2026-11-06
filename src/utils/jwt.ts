import jwt from "jsonwebtoken";
import { ClientType, JwtPayloadData, UserRole } from "../types/auth.types";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be defined in environment variables.");
  }
  return secret;
}

export interface SignTokenInput {
  userId: number;
  sessionId: string;
  role: UserRole;
  clientType: ClientType;
  expiresInSeconds: number;
}

export function signAccessToken(input: SignTokenInput): string {
  const payload: JwtPayloadData = {
    sub: input.userId,
    jti: input.sessionId,
    role: input.role,
    client_type: input.clientType,
  };

  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: input.expiresInSeconds,
  });
}

export function verifyAccessToken(token: string): JwtPayloadData | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as unknown as JwtPayloadData;
    if (
      !decoded ||
      typeof decoded.sub !== "number" ||
      typeof decoded.jti !== "string"
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
