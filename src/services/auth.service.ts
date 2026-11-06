import { randomUUID } from "crypto";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { database } from "../config/database";
import {
  AuthenticatedUser,
  ClientType,
  StudentProfile,
  UserRole,
} from "../types/auth.types";
import { AppError } from "../utils/errors";
import { signAccessToken } from "../utils/jwt";
import {
  hashPassword,
  isValidPasswordPolicy,
  verifyPassword,
} from "../utils/password";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NISN_REGEX = /^\d{10}$/;

// Precomputed dummy Argon2id hash to prevent timing attacks when account does not exist
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";

interface DbUserWithStudentRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  is_active: number;
  photo_url: string | null;
  roster_id: number | null;
  nisn: string | null;
  full_name: string | null;
  class_id: number | null;
  class_name: string | null;
  grade_level: number | null;
  attendance_number: number | null;
  parent_phone: string | null;
  whatsapp_number: string | null;
  address: string | null;
  roster_is_active: number | null;
}

export interface WebLoginInput {
  email: string;
  password: string;
  rememberMe?: boolean;
  userAgent?: string;
  ipAddress?: string;
}

export interface MobileLoginInput {
  identifier: string; // email or 10-digit NISN
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface StudentRegisterInput {
  name: string;
  nisn: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}

export interface SessionInfo {
  id: string;
  client_type: ClientType;
  user_agent: string | null;
  ip_address: string | null;
  remember_me: boolean;
  last_active_at: Date;
  created_at: Date;
  expires_at: Date;
  is_current: boolean;
}

function getSessionDurationSeconds(rememberMe: boolean): number {
  if (rememberMe) {
    const days = Number(process.env.JWT_REMEMBER_DAYS ?? 30);
    return days * 24 * 60 * 60;
  }
  const hours = Number(process.env.JWT_EXPIRES_HOURS ?? 24);
  return hours * 60 * 60;
}

function mapUserResponse(row: DbUserWithStudentRow): AuthenticatedUser {
  const user: AuthenticatedUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    photo_url: row.photo_url,
  };

  if (row.role === "siswa" && row.roster_id && row.nisn) {
    const student: StudentProfile = {
      roster_id: row.roster_id,
      nisn: row.nisn,
      full_name: row.full_name ?? row.name,
      class_id: row.class_id,
      class_name: row.class_name,
      grade_level: row.grade_level,
      attendance_number: row.attendance_number,
      parent_phone: row.parent_phone,
      whatsapp_number: row.whatsapp_number,
      address: row.address,
    };
    user.student = student;
  }

  return user;
}

async function createSessionAndToken(params: {
  userId: number;
  role: UserRole;
  clientType: ClientType;
  rememberMe: boolean;
  userAgent?: string;
  ipAddress?: string;
}): Promise<{ token: string; expiresAt: string; sessionId: string }> {
  const sessionId = randomUUID();
  const expiresInSeconds = getSessionDurationSeconds(params.rememberMe);
  const expiresAtDate = new Date(Date.now() + expiresInSeconds * 1000);

  await database.execute(
    `INSERT INTO user_sessions
      (id, user_id, client_type, user_agent, ip_address, remember_me, expires_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      sessionId,
      params.userId,
      params.clientType,
      params.userAgent ? params.userAgent.slice(0, 255) : null,
      params.ipAddress ? params.ipAddress.slice(0, 45) : null,
      params.rememberMe ? 1 : 0,
      expiresAtDate,
    ]
  );

  const token = signAccessToken({
    userId: params.userId,
    sessionId,
    role: params.role,
    clientType: params.clientType,
    expiresInSeconds,
  });

  return {
    token,
    expiresAt: expiresAtDate.toISOString(),
    sessionId,
  };
}

/**
 * US-01 — Admin/Guru login (Web)
 */
export async function loginWeb(input: WebLoginInput) {
  const email = (input.email ?? "").trim().toLowerCase();
  const password = input.password ?? "";
  const rememberMe = Boolean(input.rememberMe);

  if (!email || !password) {
    throw new AppError("Login gagal! Email atau kata sandi salah.", 401, {
      code: "INVALID_CREDENTIALS",
    });
  }

  const [rows] = await database.execute<DbUserWithStudentRow[]>(
    `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.is_active, u.photo_url
     FROM users u
     WHERE LOWER(u.email) = ?
     LIMIT 1`,
    [email]
  );

  const userRow = rows[0];
  if (!userRow) {
    await verifyPassword(DUMMY_ARGON2_HASH, password);
    throw new AppError("Login gagal! Email atau kata sandi salah.", 401, {
      code: "INVALID_CREDENTIALS",
    });
  }

  const isPasswordMatch = await verifyPassword(userRow.password_hash, password);
  if (!isPasswordMatch) {
    throw new AppError("Login gagal! Email atau kata sandi salah.", 401, {
      code: "INVALID_CREDENTIALS",
    });
  }

  // AC3: Given akun siswa mencoba login web, Then 403 "Akses ditolak"
  if (userRow.role === "siswa") {
    throw new AppError("Akses ditolak", 403, {
      code: "FORBIDDEN_ROLE",
    });
  }

  // AC4: Given akun nonaktif, Then 403 dengan pesan jelas
  if (!userRow.is_active) {
    throw new AppError(
      "Akun Anda telah dinonaktifkan. Silakan hubungi administrator sekolah.",
      403,
      { code: "ACCOUNT_INACTIVE" }
    );
  }

  const session = await createSessionAndToken({
    userId: userRow.id,
    role: userRow.role,
    clientType: "web",
    rememberMe,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });

  return {
    token: session.token,
    token_type: "Bearer",
    expires_at: session.expiresAt,
    redirect_to: "/dashboard",
    user: mapUserResponse(userRow),
  };
}

/**
 * US-02 — Siswa login (Mobile)
 * Identitas dapat berupa email atau NISN 10 digit + sandi
 */
export async function loginMobile(input: MobileLoginInput) {
  const identifier = (input.identifier ?? "").trim();
  const password = input.password ?? "";

  if (!identifier || !password) {
    throw new AppError("Login gagal! Email/NISN atau kata sandi salah.", 401, {
      code: "INVALID_CREDENTIALS",
    });
  }

  const isNisn = NISN_REGEX.test(identifier);

  const [rows] = await database.execute<DbUserWithStudentRow[]>(
    `SELECT
       u.id, u.name, u.email, u.password_hash, u.role, u.is_active, u.photo_url,
       sr.id AS roster_id, sr.nisn, sr.full_name, sr.class_id,
       c.name AS class_name, c.grade_level,
       sr.attendance_number, sr.parent_phone, sr.whatsapp_number, sr.address,
       sr.is_active AS roster_is_active
     FROM users u
     LEFT JOIN student_roster sr ON sr.user_id = u.id
     LEFT JOIN classes c ON c.id = sr.class_id
     WHERE ${isNisn ? "sr.nisn = ?" : "LOWER(u.email) = ?"}
     LIMIT 1`,
    [isNisn ? identifier : identifier.toLowerCase()]
  );

  const userRow = rows[0];
  if (!userRow) {
    await verifyPassword(DUMMY_ARGON2_HASH, password);
    throw new AppError("Login gagal! Email/NISN atau kata sandi salah.", 401, {
      code: "INVALID_CREDENTIALS",
    });
  }

  const isPasswordMatch = await verifyPassword(userRow.password_hash, password);
  if (!isPasswordMatch) {
    throw new AppError("Login gagal! Email/NISN atau kata sandi salah.", 401, {
      code: "INVALID_CREDENTIALS",
    });
  }

  // AC2: Akun admin/guru mencoba login mobile -> 403
  if (userRow.role !== "siswa") {
    throw new AppError("Akses ditolak", 403, {
      code: "FORBIDDEN_ROLE",
    });
  }

  if (!userRow.is_active || userRow.roster_is_active === 0) {
    throw new AppError(
      "Akun siswa tidak aktif. Silakan hubungi pihak sekolah.",
      403,
      { code: "ACCOUNT_INACTIVE" }
    );
  }

  const session = await createSessionAndToken({
    userId: userRow.id,
    role: userRow.role,
    clientType: "mobile",
    rememberMe: true,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });

  return {
    token: session.token,
    token_type: "Bearer",
    expires_at: session.expiresAt,
    user: mapUserResponse(userRow),
  };
}

/**
 * US-03 — Register siswa (Mobile)
 */
export async function registerStudent(input: StudentRegisterInput) {
  const name = (input.name ?? "").trim();
  const nisn = (input.nisn ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  const password = input.password ?? "";
  const passwordConfirmation = input.passwordConfirmation ?? "";

  const errors: Record<string, string> = {};

  if (!name) {
    errors.name = "Nama wajib diisi.";
  }

  if (!nisn) {
    errors.nisn = "NISN wajib diisi.";
  } else if (!NISN_REGEX.test(nisn)) {
    errors.nisn = "NISN harus terdiri dari 10 digit angka.";
  }

  // AC4: Format email salah -> 400 dengan errors.email
  if (!email) {
    errors.email = "Email wajib diisi.";
  } else if (!EMAIL_REGEX.test(email)) {
    errors.email = "Format email tidak valid.";
  }

  // AC1: sandi (>= 8, huruf & angka), konfirmasi sandi
  if (!password) {
    errors.password = "Kata sandi wajib diisi.";
  } else if (!isValidPasswordPolicy(password)) {
    errors.password =
      "Kata sandi minimal 8 karakter dan wajib mengandung huruf serta angka.";
  }

  if (!passwordConfirmation) {
    errors.password_confirmation = "Konfirmasi kata sandi wajib diisi.";
  } else if (password !== passwordConfirmation) {
    errors.password_confirmation = "Konfirmasi kata sandi tidak cocok.";
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi data pendaftaran gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();

    // Check roster by NISN with row lock
    const [rosterRows] = await connection.execute<RowDataPacket[]>(
      `SELECT sr.id, sr.nisn, sr.full_name, sr.class_id, sr.user_id, sr.is_active,
              c.name AS class_name, c.grade_level
       FROM student_roster sr
       LEFT JOIN classes c ON c.id = sr.class_id
       WHERE sr.nisn = ?
       FOR UPDATE`,
      [nisn]
    );

    const roster = rosterRows[0];

    // AC2: NISN harus ada di roster; jika tidak -> 422 "NISN tidak terdaftar di sekolah"
    if (!roster || !roster.is_active) {
      throw new AppError("NISN tidak terdaftar di sekolah", 422, {
        code: "NISN_NOT_IN_ROSTER",
        errors: { nisn: "NISN tidak terdaftar di sekolah" },
      });
    }

    // AC3: NISN sudah diklaim -> 409 "NISN sudah terdaftar"
    if (roster.user_id !== null) {
      throw new AppError("NISN sudah terdaftar", 409, {
        code: "NISN_ALREADY_REGISTERED",
        errors: { nisn: "NISN sudah terdaftar" },
      });
    }

    // AC3: Email sudah dipakai -> 409
    const [existingEmailRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`,
      [email]
    );

    if (existingEmailRows.length > 0) {
      throw new AppError("Email sudah terdaftar", 409, {
        code: "EMAIL_ALREADY_REGISTERED",
        errors: { email: "Email sudah terdaftar" },
      });
    }

    const passwordHash = await hashPassword(password);

    const [insertResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, 'siswa', 1)`,
      [name, email, passwordHash]
    );

    const newUserId = insertResult.insertId;

    await connection.execute(
      `UPDATE student_roster
       SET user_id = ?
       WHERE id = ?`,
      [newUserId, roster.id]
    );

    await connection.commit();

    return {
      id: newUserId,
      name,
      email,
      role: "siswa" as const,
      student: {
        roster_id: roster.id as number,
        nisn: roster.nisn as string,
        full_name: roster.full_name as string,
        class_id: (roster.class_id as number | null) ?? null,
        class_name: (roster.class_name as string | null) ?? null,
        grade_level: (roster.grade_level as number | null) ?? null,
      },
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * US-06 — Logout (mencabut token di server)
 */
export async function logoutSession(
  sessionId: string,
  userId: number
): Promise<void> {
  await database.execute(
    `UPDATE user_sessions
     SET revoked_at = NOW()
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [sessionId, userId]
  );
}

/**
 * Verifikasi sesi aktif di database (US-01 AC6, US-04 AC2, US-06 AC)
 * Jika akun dihapus/nonaktif atau sesi sudah dicabut/kedaluwarsa -> null (401)
 */
export async function verifyActiveSession(
  sessionId: string,
  userId: number
): Promise<AuthenticatedUser | null> {
  const [rows] = await database.execute<DbUserWithStudentRow[]>(
    `SELECT
       u.id, u.name, u.email, u.password_hash, u.role, u.is_active, u.photo_url,
       sr.id AS roster_id, sr.nisn, sr.full_name, sr.class_id,
       c.name AS class_name, c.grade_level,
       sr.attendance_number, sr.parent_phone, sr.whatsapp_number, sr.address,
       sr.is_active AS roster_is_active
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN student_roster sr ON sr.user_id = u.id
     LEFT JOIN classes c ON c.id = sr.class_id
     WHERE s.id = ?
       AND s.user_id = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND u.is_active = 1
     LIMIT 1`,
    [sessionId, userId]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  if (row.role === "siswa" && row.roster_is_active === 0) {
    return null;
  }

  // Update last_active_at asynchronously
  void database
    .execute(`UPDATE user_sessions SET last_active_at = NOW() WHERE id = ?`, [
      sessionId,
    ])
    .catch(() => {});

  return mapUserResponse(row);
}

/**
 * US-62 AC4 — Daftar sesi aktif pengguna
 */
export async function listUserSessions(
  userId: number,
  currentSessionId: string
): Promise<SessionInfo[]> {
  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT id, client_type, user_agent, ip_address, remember_me, last_active_at, created_at, expires_at
     FROM user_sessions
     WHERE user_id = ?
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY last_active_at DESC`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id as string,
    client_type: row.client_type as ClientType,
    user_agent: (row.user_agent as string | null) ?? null,
    ip_address: (row.ip_address as string | null) ?? null,
    remember_me: Boolean(row.remember_me),
    last_active_at: new Date(row.last_active_at),
    created_at: new Date(row.created_at),
    expires_at: new Date(row.expires_at),
    is_current: row.id === currentSessionId,
  }));
}

/**
 * US-61 & US-62 — Update profil pengguna
 * - Admin/Guru dapat mengubah nama & email (US-62 AC1)
 * - Siswa hanya dapat mengubah whatsapp_number & address, tidak bisa mengubah data akademik (US-61 AC1 & AC2)
 */
export async function updateProfile(
  user: AuthenticatedUser,
  payload: {
    name?: string;
    email?: string;
    whatsapp_number?: string;
    address?: string;
  }
): Promise<AuthenticatedUser> {
  if (user.role === "siswa") {
    const whatsappNumber =
      payload.whatsapp_number !== undefined
        ? payload.whatsapp_number.trim()
        : undefined;
    const address =
      payload.address !== undefined ? payload.address.trim() : undefined;

    if (whatsappNumber === undefined && address === undefined) {
      throw new AppError(
        "Tidak ada perubahan profil yang dikirim (whatsapp_number / address).",
        400
      );
    }

    await database.execute(
      `UPDATE student_roster
       SET whatsapp_number = COALESCE(?, whatsapp_number),
           address = COALESCE(?, address)
       WHERE user_id = ?`,
      [whatsappNumber ?? null, address ?? null, user.id]
    );
  } else {
    const errors: Record<string, string> = {};
    const name = payload.name !== undefined ? payload.name.trim() : user.name;
    const email =
      payload.email !== undefined
        ? payload.email.trim().toLowerCase()
        : user.email;

    if (!name) {
      errors.name = "Nama wajib diisi.";
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      errors.email = "Format email tidak valid.";
    }

    if (Object.keys(errors).length > 0) {
      throw new AppError("Validasi gagal.", 400, {
        code: "VALIDATION_ERROR",
        errors,
      });
    }

    if (email !== user.email.toLowerCase()) {
      const [existing] = await database.execute<RowDataPacket[]>(
        `SELECT id FROM users WHERE LOWER(email) = ? AND id != ? LIMIT 1`,
        [email, user.id]
      );
      if (existing.length > 0) {
        throw new AppError("Email sudah digunakan oleh akun lain.", 409, {
          code: "EMAIL_ALREADY_REGISTERED",
          errors: { email: "Email sudah digunakan oleh akun lain." },
        });
      }
    }

    await database.execute(`UPDATE users SET name = ?, email = ? WHERE id = ?`, [
      name,
      email,
      user.id,
    ]);
  }

  const [updatedRows] = await database.execute<DbUserWithStudentRow[]>(
    `SELECT
       u.id, u.name, u.email, u.password_hash, u.role, u.is_active, u.photo_url,
       sr.id AS roster_id, sr.nisn, sr.full_name, sr.class_id,
       c.name AS class_name, c.grade_level,
       sr.attendance_number, sr.parent_phone, sr.whatsapp_number, sr.address,
       sr.is_active AS roster_is_active
     FROM users u
     LEFT JOIN student_roster sr ON sr.user_id = u.id
     LEFT JOIN classes c ON c.id = sr.class_id
     WHERE u.id = ?
     LIMIT 1`,
    [user.id]
  );

  return mapUserResponse(updatedRows[0]);
}

/**
 * US-62 AC3 — Ganti sandi dengan sandi lama; sesi lain dicabut
 */
export async function changePassword(params: {
  userId: number;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
}): Promise<void> {
  const {
    userId,
    currentSessionId,
    currentPassword,
    newPassword,
    newPasswordConfirmation,
  } = params;

  const errors: Record<string, string> = {};
  if (!currentPassword) {
    errors.current_password = "Kata sandi lama wajib diisi.";
  }
  if (!newPassword || !isValidPasswordPolicy(newPassword)) {
    errors.new_password =
      "Kata sandi baru minimal 8 karakter dan wajib mengandung huruf serta angka.";
  }
  if (newPassword !== newPasswordConfirmation) {
    errors.new_password_confirmation =
      "Konfirmasi kata sandi baru tidak cocok.";
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi ganti kata sandi gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  const isOldValid = await verifyPassword(
    rows[0].password_hash as string,
    currentPassword
  );
  if (!isOldValid) {
    throw new AppError("Kata sandi lama tidak sesuai.", 400, {
      code: "INVALID_OLD_PASSWORD",
      errors: { current_password: "Kata sandi lama tidak sesuai." },
    });
  }

  const newHash = await hashPassword(newPassword);

  await database.execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [
    newHash,
    userId,
  ]);

  // Cabut semua sesi lain milik pengguna ini
  await database.execute(
    `UPDATE user_sessions
     SET revoked_at = NOW()
     WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
    [userId, currentSessionId]
  );
}
