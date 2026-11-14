export type UserRole = "admin" | "guru" | "siswa";
export type ClientType = "web" | "mobile";

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  is_active: number;
  photo_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface StudentProfile {
  roster_id: number;
  nisn: string;
  full_name: string;
  class_id: number | null;
  class_name: string | null;
  grade_level: number | null;
  attendance_number: number | null;
  parent_phone: string | null;
  whatsapp_number: string | null;
  address: string | null;
}

export interface AuthenticatedUser {
  id: number;
  staff_code?: string;
  name: string;
  email: string;
  role: UserRole;
  photo_url: string | null;
  avatar_url?: string | null;
  student?: StudentProfile;
}

export interface JwtPayloadData {
  sub: number;
  jti: string;
  role: UserRole;
  client_type: ClientType;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: AuthenticatedUser;
        sessionId: string;
        clientType: ClientType;
      };
    }
  }
}
