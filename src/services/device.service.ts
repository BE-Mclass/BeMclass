import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";

export type DevicePlatform = "android" | "ios";

export interface DeviceTokenItem {
  id: number;
  user_id: number;
  platform: DevicePlatform;
  token: string;
  created_at: string;
}

interface DeviceTokenRow extends RowDataPacket {
  id: number;
  user_id: number;
  platform: DevicePlatform;
  token: string;
  created_at: Date | string;
}

let deviceTokensTableChecked = false;

async function ensureDeviceTokensTable(): Promise<void> {
  if (deviceTokensTableChecked) {
    return;
  }
  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        platform ENUM('android', 'ios') NOT NULL,
        token VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_device_token (token),
        INDEX idx_device_user (user_id),
        CONSTRAINT fk_dev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    deviceTokensTableChecked = true;
  } catch {
    deviceTokensTableChecked = true;
  }
}

export function resetDeviceTokensTableCheckForTesting(): void {
  deviceTokensTableChecked = true;
}

function toIsoString(val: Date | string | null | undefined): string {
  if (!val) {
    return new Date().toISOString();
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString();
  }
  if (typeof val === "string") {
    const parsed = new Date(val);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return val;
  }
  return new Date().toISOString();
}

function mapDeviceTokenRow(row: DeviceTokenRow): DeviceTokenItem {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    platform: row.platform,
    token: row.token,
    created_at: toIsoString(row.created_at),
  };
}

/**
 * M-PUSH & FSD §5.9 (P1) — POST /api/devices
 * Mendaftarkan atau memperbarui token FCM (Firebase Cloud Messaging) perangkat pengguna.
 * Bersifat idempoten (upsert berdasarkan `token` unik).
 */
export async function registerDeviceToken(
  userId: number,
  payload: unknown
): Promise<DeviceTokenItem> {
  await ensureDeviceTokensTable();

  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const errors: Record<string, string> = {};

  // Terima field `token` (atau alias `fcm_token` / `device_token`)
  const rawToken = body.token ?? body.fcm_token ?? body.device_token;
  let token = "";
  if (typeof rawToken !== "string" || rawToken.trim().length === 0) {
    errors.token = "Token FCM perangkat wajib diisi.";
  } else {
    token = rawToken.trim();
    if (token.length < 10) {
      errors.token = "Token FCM perangkat terlalu pendek (minimal 10 karakter).";
    } else if (token.length > 255) {
      errors.token = "Token FCM perangkat maksimal 255 karakter.";
    }
  }

  // Terima field `platform` (atau alias `os`) -> wajib 'android' atau 'ios'
  const rawPlatform = body.platform ?? body.os;
  let platform: DevicePlatform = "android";
  if (typeof rawPlatform !== "string" || rawPlatform.trim().length === 0) {
    errors.platform = "Platform perangkat wajib diisi ('android' atau 'ios').";
  } else {
    const normalized = rawPlatform.trim().toLowerCase();
    if (normalized !== "android" && normalized !== "ios") {
      errors.platform = "Platform tidak valid. Gunakan 'android' atau 'ios'.";
    } else {
      platform = normalized;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Data registrasi perangkat tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  // Cek apakah token sudah ada di database (upsert idempoten)
  const [existingRows] = await database.execute<DeviceTokenRow[]>(
    `SELECT id, user_id, platform, token, created_at
     FROM device_tokens
     WHERE token = ?
     LIMIT 1`,
    [token]
  );

  if (existingRows.length > 0) {
    const existing = existingRows[0];
    await database.execute(
      `UPDATE device_tokens
       SET user_id = ?, platform = ?, created_at = NOW()
       WHERE id = ?`,
      [userId, platform, existing.id]
    );

    const [updatedRows] = await database.execute<DeviceTokenRow[]>(
      `SELECT id, user_id, platform, token, created_at
       FROM device_tokens
       WHERE id = ?
       LIMIT 1`,
      [existing.id]
    );

    return mapDeviceTokenRow(
      updatedRows[0] ?? {
        ...existing,
        user_id: userId,
        platform,
        created_at: new Date(),
      }
    );
  }

  const [result] = await database.execute<ResultSetHeader>(
    `INSERT INTO device_tokens (user_id, platform, token)
     VALUES (?, ?, ?)`,
    [userId, platform, token]
  );

  const [insertedRows] = await database.execute<DeviceTokenRow[]>(
    `SELECT id, user_id, platform, token, created_at
     FROM device_tokens
     WHERE id = ?
     LIMIT 1`,
    [result.insertId]
  );

  if (insertedRows.length > 0) {
    return mapDeviceTokenRow(insertedRows[0]);
  }

  return {
    id: Number(result.insertId),
    user_id: userId,
    platform,
    token,
    created_at: new Date().toISOString(),
  };
}

/**
 * GET /api/devices
 * Mengambil daftar perangkat/token FCM yang terdaftar untuk pengguna saat ini.
 */
export async function listUserDeviceTokens(
  userId: number
): Promise<DeviceTokenItem[]> {
  await ensureDeviceTokensTable();

  const [rows] = await database.execute<DeviceTokenRow[]>(
    `SELECT id, user_id, platform, token, created_at
     FROM device_tokens
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC`,
    [userId]
  );

  return rows.map(mapDeviceTokenRow);
}

/**
 * DELETE /api/devices/:token (atau DELETE /api/devices dengan body `{ token }`)
 * Menghapus registrasi token FCM perangkat milik pengguna (mis. saat logout).
 */
export async function unregisterDeviceToken(
  userId: number,
  rawTokenOrId: unknown
): Promise<{ deleted: boolean; token_or_id: string }> {
  await ensureDeviceTokensTable();

  const value =
    typeof rawTokenOrId === "string" ? rawTokenOrId.trim() : "";
  if (!value) {
    throw new AppError("Token atau ID perangkat wajib disertakan.", 400, {
      code: "VALIDATION_ERROR",
      errors: { token: "Token atau ID perangkat wajib diisi." },
    });
  }

  // Jika berupa angka murni pendek, cek berdasarkan id atau token; selainnya berdasarkan token
  const isNumericId = /^\d{1,10}$/.test(value);

  const [existingRows] = await database.execute<DeviceTokenRow[]>(
    isNumericId
      ? `SELECT id, user_id, platform, token, created_at
         FROM device_tokens
         WHERE (id = ? OR token = ?) AND user_id = ?
         LIMIT 1`
      : `SELECT id, user_id, platform, token, created_at
         FROM device_tokens
         WHERE token = ? AND user_id = ?
         LIMIT 1`,
    isNumericId ? [Number(value), value, userId] : [value, userId]
  );

  if (existingRows.length === 0) {
    throw new AppError("Token perangkat tidak ditemukan.", 404, {
      code: "NOT_FOUND",
    });
  }

  await database.execute(
    `DELETE FROM device_tokens WHERE id = ? AND user_id = ?`,
    [existingRows[0].id, userId]
  );

  return {
    deleted: true,
    token_or_id: value,
  };
}
