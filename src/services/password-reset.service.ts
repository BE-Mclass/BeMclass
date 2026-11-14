import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";
import { sendPasswordResetOtpEmail } from "../utils/mailer";
import { hashPassword, isValidPasswordPolicy } from "../utils/password";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_REGEX = /^\d{6}$/;

const DEFAULT_OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS ?? 600); // 10 menit (BR-06)
const DEFAULT_OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5); // 5 kali salah -> hangus (BR-06)
const DEFAULT_OTP_RESEND_COOLDOWN_SECONDS = Number(
  process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60
); // 60 detik (BR-06)
const DEFAULT_OTP_MAX_SENDS_PER_HOUR = Number(
  process.env.OTP_MAX_SENDS_PER_HOUR ?? 5
); // maks 5 kirim/jam (BR-06)
const DEFAULT_RESET_TOKEN_TTL_SECONDS = Number(
  process.env.RESET_TOKEN_TTL_SECONDS ?? 900
); // 15 menit (BR-07)

interface UserStudentLookupRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  role: "admin" | "guru" | "siswa";
  is_active: number;
}

interface PasswordResetRow extends RowDataPacket {
  id: number;
  user_id: number;
  otp_hash: string;
  attempts: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  reset_token_hash: string | null;
  reset_token_expires_at: Date | string | null;
  last_sent_at: Date | string;
  created_at: Date | string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

let passwordResetsTableChecked = false;

async function ensurePasswordResetsTable(): Promise<void> {
  if (passwordResetsTableChecked) {
    return;
  }
  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        otp_hash CHAR(64) NOT NULL COMMENT 'HMAC-SHA256 hex of 6-digit OTP',
        attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        consumed_at DATETIME NULL,
        reset_token_hash CHAR(64) NULL COMMENT 'HMAC-SHA256 hex of single-use reset_token',
        reset_token_expires_at DATETIME NULL,
        last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pr_user_created (user_id, created_at),
        INDEX idx_pr_reset_token (reset_token_hash),
        CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    passwordResetsTableChecked = true;
  } catch {
    passwordResetsTableChecked = true;
  }
}

export function resetPasswordResetsTableCheckForTesting(): void {
  passwordResetsTableChecked = true;
}

function getHmacSecret(): string {
  return (
    process.env.OTP_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "mclass-default-otp-hmac-secret-key"
  );
}

export function hashTokenOrOtp(raw: string): string {
  return createHmac("sha256", getHmacSecret()).update(raw).digest("hex");
}

function safeCompareHexHash(expectedHex: string, actualHex: string): boolean {
  if (expectedHex.length !== actualHex.length) {
    return false;
  }
  const bufA = Buffer.from(expectedHex, "utf8");
  const bufB = Buffer.from(actualHex, "utf8");
  return timingSafeEqual(bufA, bufB);
}

function toMysqlDateTime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

/**
 * US-05 & BR-06 — Langkah 1: POST /api/auth/forgot-password
 * Mengirim kode OTP 6 digit ke email siswa.
 * Jika email tidak terdaftar atau milik admin/guru, mengembalikan respons 200 identik
 * tanpa mengirim OTP (mencegah user enumeration, BR-06).
 */
export async function requestPasswordResetOtp(input: {
  email?: unknown;
}): Promise<{
  message: string;
  resend_available_in: number;
  dev_otp?: string;
}> {
  await ensurePasswordResetsTable();

  const rawEmail = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!rawEmail) {
    throw new AppError("Validasi gagal. Periksa kembali data yang Anda masukkan.", 400, {
      code: "VALIDATION_ERROR",
      errors: { email: "Email wajib diisi." },
    });
  }
  if (!EMAIL_REGEX.test(rawEmail)) {
    throw new AppError("Validasi gagal. Periksa kembali data yang Anda masukkan.", 400, {
      code: "VALIDATION_ERROR",
      errors: { email: "Format email tidak valid." },
    });
  }

  const genericMessage = "Jika email terdaftar, kode OTP telah dikirim.";

  const [users] = await database.execute<UserStudentLookupRow[]>(
    `SELECT id, name, email, role, is_active
     FROM users
     WHERE LOWER(email) = ?
     LIMIT 1`,
    [rawEmail]
  );

  // BR-06: Hanya akun siswa aktif; email tidak terdaftar atau milik admin/guru -> 200 identik tanpa OTP
  if (users.length === 0 || users[0].role !== "siswa" || !users[0].is_active) {
    return {
      message: genericMessage,
      resend_available_in: DEFAULT_OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  const user = users[0];
  const now = new Date();

  // Cek cooldown kirim ulang (OTP_RESEND_COOLDOWN = 60 detik, BR-06)
  const [latestRows] = await database.execute<PasswordResetRow[]>(
    `SELECT id, last_sent_at
     FROM password_resets
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [user.id]
  );

  if (latestRows.length > 0 && latestRows[0].last_sent_at) {
    const lastSentMs = new Date(latestRows[0].last_sent_at).getTime();
    const elapsedSeconds = Math.floor((now.getTime() - lastSentMs) / 1000);
    if (elapsedSeconds < DEFAULT_OTP_RESEND_COOLDOWN_SECONDS) {
      const retryAfter = DEFAULT_OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      throw new AppError(
        `Mohon tunggu ${retryAfter} detik sebelum meminta kode OTP baru.`,
        429,
        {
          code: "OTP_COOLDOWN",
          details: { retry_after_seconds: retryAfter },
        }
      );
    }
  }

  // Cek batas pengiriman per jam (OTP_MAX_SENDS_PER_HOUR = 5, BR-06)
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000);
  const [hourlyCountRows] = await database.execute<CountRow[]>(
    `SELECT COUNT(*) AS total
     FROM password_resets
     WHERE user_id = ? AND created_at >= ?`,
    [user.id, toMysqlDateTime(oneHourAgo)]
  );
  const totalSentLastHour = Number(hourlyCountRows[0]?.total ?? 0);
  if (totalSentLastHour >= DEFAULT_OTP_MAX_SENDS_PER_HOUR) {
    throw new AppError(
      "Terlalu banyak permintaan kode OTP dalam 1 jam terakhir. Silakan coba lagi nanti.",
      429,
      { code: "RATE_LIMITED" }
    );
  }

  // Hanguskan OTP sebelumnya yang belum dipakai untuk user ini
  const nowSql = toMysqlDateTime(now);
  await database.execute(
    `UPDATE password_resets
     SET consumed_at = ?
     WHERE user_id = ? AND consumed_at IS NULL`,
    [nowSql, user.id]
  );

  // Buat OTP 6 digit acak kriptografis
  const otp = String(randomInt(100000, 1000000));
  const otpHash = hashTokenOrOtp(otp);
  const expiresAt = new Date(now.getTime() + DEFAULT_OTP_TTL_SECONDS * 1000);

  await database.execute<ResultSetHeader>(
    `INSERT INTO password_resets
       (user_id, otp_hash, attempts, expires_at, last_sent_at, created_at)
     VALUES (?, ?, 0, ?, ?, ?)`,
    [user.id, otpHash, toMysqlDateTime(expiresAt), nowSql, nowSql]
  );

  await sendPasswordResetOtpEmail({
    to: user.email,
    name: user.name,
    otp,
    ttlMinutes: Math.round(DEFAULT_OTP_TTL_SECONDS / 60),
  });

  const isDev = process.env.NODE_ENV !== "production";

  return {
    message: genericMessage,
    resend_available_in: DEFAULT_OTP_RESEND_COOLDOWN_SECONDS,
    ...(isDev ? { dev_otp: otp } : {}),
  };
}

/**
 * US-05, BR-06 & BR-07 — Langkah 2: POST /api/auth/verify-otp
 * Memverifikasi kode OTP 6 digit dan mengeluarkan `reset_token` sekali pakai (berlaku 15 menit).
 */
export async function verifyPasswordResetOtp(input: {
  email?: unknown;
  otp?: unknown;
}): Promise<{
  reset_token: string;
  expires_in: number;
  user_id: number;
}> {
  await ensurePasswordResetsTable();

  const errors: Record<string, string> = {};
  const rawEmail = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const rawOtp = typeof input.otp === "string" ? input.otp.trim() : "";

  if (!rawEmail) {
    errors.email = "Email wajib diisi.";
  } else if (!EMAIL_REGEX.test(rawEmail)) {
    errors.email = "Format email tidak valid.";
  }

  if (!rawOtp) {
    errors.otp = "Kode OTP wajib diisi.";
  } else if (!OTP_REGEX.test(rawOtp)) {
    errors.otp = "Kode OTP harus terdiri dari 6 digit angka.";
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi gagal. Periksa kembali email dan kode OTP.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  const [users] = await database.execute<UserStudentLookupRow[]>(
    `SELECT id, name, email, role, is_active
     FROM users
     WHERE LOWER(email) = ?
     LIMIT 1`,
    [rawEmail]
  );

  if (users.length === 0 || users[0].role !== "siswa" || !users[0].is_active) {
    throw new AppError("Kode OTP tidak valid atau sudah kedaluwarsa.", 400, {
      code: "OTP_INVALID",
    });
  }

  const user = users[0];

  const [resetRows] = await database.execute<PasswordResetRow[]>(
    `SELECT *
     FROM password_resets
     WHERE user_id = ? AND consumed_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [user.id]
  );

  if (resetRows.length === 0) {
    throw new AppError("Kode OTP tidak valid atau belum diminta.", 400, {
      code: "OTP_INVALID",
    });
  }

  const row = resetRows[0];
  const now = new Date();
  const nowSql = toMysqlDateTime(now);

  // Jika OTP sudah pernah ditukar menjadi reset_token, tolak penggunaan ulang OTP yang sama
  if (row.reset_token_hash !== null) {
    throw new AppError("Kode OTP sudah digunakan.", 400, {
      code: "OTP_INVALID",
    });
  }

  // Cek batas percobaan (maks 5 kali salah -> hangus, BR-06)
  if (Number(row.attempts) >= DEFAULT_OTP_MAX_ATTEMPTS) {
    await database.execute(
      `UPDATE password_resets SET consumed_at = ? WHERE id = ?`,
      [nowSql, row.id]
    );
    throw new AppError(
      "Batas percobaan OTP telah habis. Kode OTP dihanguskan, silakan minta kode baru.",
      429,
      { code: "OTP_ATTEMPTS_EXCEEDED" }
    );
  }

  // Cek masa berlaku OTP (10 menit, BR-06)
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (now.getTime() > expiresAtMs) {
    await database.execute(
      `UPDATE password_resets SET consumed_at = ? WHERE id = ?`,
      [nowSql, row.id]
    );
    throw new AppError("Kode OTP telah kedaluwarsa. Silakan minta kode OTP baru.", 400, {
      code: "OTP_EXPIRED",
    });
  }

  // Bandingkan hash OTP secara timing-safe
  const incomingOtpHash = hashTokenOrOtp(rawOtp);
  if (!safeCompareHexHash(row.otp_hash, incomingOtpHash)) {
    const nextAttempts = Number(row.attempts) + 1;
    if (nextAttempts >= DEFAULT_OTP_MAX_ATTEMPTS) {
      await database.execute(
        `UPDATE password_resets
         SET attempts = ?, consumed_at = ?
         WHERE id = ?`,
        [nextAttempts, nowSql, row.id]
      );
      throw new AppError(
        "Batas percobaan OTP telah habis. Kode OTP dihanguskan, silakan minta kode baru.",
        429,
        { code: "OTP_ATTEMPTS_EXCEEDED" }
      );
    }

    await database.execute(
      `UPDATE password_resets SET attempts = ? WHERE id = ?`,
      [nextAttempts, row.id]
    );
    throw new AppError("Kode OTP yang Anda masukkan salah.", 400, {
      code: "OTP_INVALID",
      details: {
        remaining_attempts: DEFAULT_OTP_MAX_ATTEMPTS - nextAttempts,
      },
    });
  }

  // OTP cocok -> keluarkan reset_token (acak, sekali pakai, berlaku 15 menit, BR-07)
  const resetToken = randomBytes(32).toString("hex");
  const resetTokenHash = hashTokenOrOtp(resetToken);
  const resetTokenExpiresAt = new Date(
    now.getTime() + DEFAULT_RESET_TOKEN_TTL_SECONDS * 1000
  );

  await database.execute(
    `UPDATE password_resets
     SET reset_token_hash = ?,
         reset_token_expires_at = ?
     WHERE id = ?`,
    [resetTokenHash, toMysqlDateTime(resetTokenExpiresAt), row.id]
  );

  return {
    reset_token: resetToken,
    expires_in: DEFAULT_RESET_TOKEN_TTL_SECONDS,
    user_id: user.id,
  };
}

/**
 * US-05, BR-01, BR-05 & BR-07 — Langkah 3: POST /api/auth/reset-password
 * Menukar `reset_token` dengan kata sandi baru (Argon2id) dan mencabut seluruh sesi aktif siswa.
 */
export async function completePasswordReset(input: {
  resetToken?: unknown;
  newPassword?: unknown;
  passwordConfirmation?: unknown;
}): Promise<{
  userId: number;
  message: string;
}> {
  await ensurePasswordResetsTable();

  const errors: Record<string, string> = {};
  const rawToken =
    typeof input.resetToken === "string" ? input.resetToken.trim() : "";
  const newPassword =
    typeof input.newPassword === "string" ? input.newPassword : "";
  const passwordConfirmation =
    typeof input.passwordConfirmation === "string"
      ? input.passwordConfirmation
      : undefined;

  if (!rawToken) {
    errors.reset_token = "Token reset kata sandi wajib diisi.";
  }

  if (!newPassword) {
    errors.new_password = "Kata sandi baru wajib diisi.";
  } else if (!isValidPasswordPolicy(newPassword)) {
    errors.new_password =
      "Kata sandi minimal 8 karakter serta wajib mengandung huruf dan angka.";
  }

  if (
    passwordConfirmation !== undefined &&
    passwordConfirmation !== newPassword
  ) {
    errors.password_confirmation = "Konfirmasi kata sandi baru tidak cocok.";
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi reset kata sandi gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  const tokenHash = hashTokenOrOtp(rawToken);
  const [rows] = await database.execute<PasswordResetRow[]>(
    `SELECT *
     FROM password_resets
     WHERE reset_token_hash = ? AND consumed_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [tokenHash]
  );

  if (rows.length === 0 || !rows[0].reset_token_expires_at) {
    throw new AppError(
      "Token reset kata sandi tidak valid atau sudah digunakan.",
      400,
      { code: "RESET_TOKEN_INVALID" }
    );
  }

  const row = rows[0];
  const now = new Date();
  const nowSql = toMysqlDateTime(now);
  const tokenExpiresMs = new Date(row.reset_token_expires_at!).getTime();

  if (now.getTime() > tokenExpiresMs) {
    await database.execute(
      `UPDATE password_resets SET consumed_at = ? WHERE id = ?`,
      [nowSql, row.id]
    );
    throw new AppError(
      "Token reset kata sandi telah kedaluwarsa. Silakan ulangi proses lupa kata sandi.",
      400,
      { code: "RESET_TOKEN_INVALID" }
    );
  }

  const [users] = await database.execute<UserStudentLookupRow[]>(
    `SELECT id, role, is_active FROM users WHERE id = ? LIMIT 1`,
    [row.user_id]
  );

  if (users.length === 0 || users[0].role !== "siswa" || !users[0].is_active) {
    throw new AppError("Token reset kata sandi tidak valid.", 400, {
      code: "RESET_TOKEN_INVALID",
    });
  }

  const newPasswordHash = await hashPassword(newPassword);

  // 1. Perbarui password_hash akun siswa
  await database.execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [
    newPasswordHash,
    row.user_id,
  ]);

  // 2. Tandai seluruh baris password_resets aktif milik siswa sebagai consumed (sekali pakai)
  await database.execute(
    `UPDATE password_resets
     SET consumed_at = ?
     WHERE user_id = ? AND consumed_at IS NULL`,
    [nowSql, row.user_id]
  );

  // 3. Cabut seluruh sesi aktif milik siswa (BR-05: "reset: semua")
  await database.execute(
    `UPDATE user_sessions
     SET revoked_at = ?
     WHERE user_id = ? AND revoked_at IS NULL`,
    [nowSql, row.user_id]
  );

  return {
    userId: row.user_id,
    message: "Kata sandi berhasil diperbarui.",
  };
}
