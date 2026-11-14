import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";

const SENSITIVE_META_KEYS = new Set([
  "password",
  "password_hash",
  "passwordhash",
  "current_password",
  "new_password",
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "reset_token",
  "otp",
  "otp_hash",
  "secret",
  "embedding",
]);

export type AuditAction =
  | "auth.staff_login.success"
  | "auth.staff_login.failed"
  | "auth.logout"
  | "auth.password.change"
  | "face_scan.view"
  | "leave_request.review"
  | "announcement.create"
  | "announcement.update"
  | "announcement.delete"
  | "school.geofence.update"
  | "school.schedule.update"
  | "student.face.reset"
  | "roster.create"
  | "roster.update"
  | "roster.delete"
  | "report.attendance.export"
  | "job.manual_trigger"
  | (string & {});

export interface AuditLogInput {
  actorUserId?: number | null;
  action: AuditAction;
  entity?: string | null;
  entityId?: string | number | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}

export interface AuditLogItem {
  id: number;
  actor_user_id: number | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

export interface ListAuditLogsFilters {
  actor_user_id?: unknown;
  action?: unknown;
  entity?: unknown;
  entity_id?: unknown;
  from?: unknown;
  to?: unknown;
  page?: unknown;
  limit?: unknown;
}

let auditTableEnsured = false;

/**
 * Ensures the `audit_logs` table exists (0 foreign keys — TRD §4.2).
 */
export async function ensureAuditLogsTable(): Promise<void> {
  if (auditTableEnsured) {
    return;
  }
  await database.execute(
    `CREATE TABLE IF NOT EXISTS audit_logs (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       actor_user_id BIGINT UNSIGNED NULL,
       action VARCHAR(60) NOT NULL,
       entity VARCHAR(40) NULL,
       entity_id VARCHAR(40) NULL,
       meta JSON NULL,
       ip VARCHAR(45) NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_audit_actor (actor_user_id, created_at),
       INDEX idx_audit_action (action, created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  auditTableEnsured = true;
}

/**
 * Redacts sensitive fields from audit metadata (TRD §9.3 & §9.6).
 */
export function sanitizeAuditMeta(
  meta?: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_META_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      sanitized[key] = sanitizeAuditMeta(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function normalizeIp(ip?: string | null): string | null {
  if (!ip || typeof ip !== "string") {
    return null;
  }
  const trimmed = ip.trim();
  return trimmed ? trimmed.slice(0, 45) : null;
}

function mapAuditRow(row: RowDataPacket): AuditLogItem {
  let parsedMeta: Record<string, unknown> | null = null;
  if (row.meta !== null && row.meta !== undefined) {
    if (typeof row.meta === "string") {
      try {
        parsedMeta = JSON.parse(row.meta);
      } catch {
        parsedMeta = null;
      }
    } else if (typeof row.meta === "object") {
      parsedMeta = row.meta as Record<string, unknown>;
    }
  }

  return {
    id: Number(row.id),
    actor_user_id:
      row.actor_user_id !== null && row.actor_user_id !== undefined
        ? Number(row.actor_user_id)
        : null,
    action: String(row.action),
    entity: row.entity !== null && row.entity !== undefined ? String(row.entity) : null,
    entity_id:
      row.entity_id !== null && row.entity_id !== undefined
        ? String(row.entity_id)
        : null,
    meta: parsedMeta,
    ip: row.ip !== null && row.ip !== undefined ? String(row.ip) : null,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  };
}

/**
 * Mencatat satu entri audit log ke tabel `audit_logs` (FSD §7, US-70 AC4, NFR-06).
 */
export async function recordAuditLog(
  input: AuditLogInput
): Promise<AuditLogItem> {
  await ensureAuditLogsTable();

  const actorUserId =
    typeof input.actorUserId === "number" && Number.isSafeInteger(input.actorUserId)
      ? input.actorUserId
      : null;
  const action = String(input.action).trim().slice(0, 60);
  const entity =
    input.entity !== undefined && input.entity !== null && String(input.entity).trim() !== ""
      ? String(input.entity).trim().slice(0, 40)
      : null;
  const entityId =
    input.entityId !== undefined &&
    input.entityId !== null &&
    String(input.entityId).trim() !== ""
      ? String(input.entityId).trim().slice(0, 40)
      : null;
  const sanitizedMeta = sanitizeAuditMeta(input.meta);
  const metaJson = sanitizedMeta ? JSON.stringify(sanitizedMeta) : null;
  const ip = normalizeIp(input.ip);

  const [result] = await database.execute<ResultSetHeader>(
    `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, meta, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [actorUserId, action, entity, entityId, metaJson, ip]
  );

  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT id, actor_user_id, action, entity, entity_id, meta, ip, created_at
     FROM audit_logs
     WHERE id = ?
     LIMIT 1`,
    [result.insertId]
  );

  if (rows.length > 0) {
    return mapAuditRow(rows[0]);
  }

  return {
    id: result.insertId,
    actor_user_id: actorUserId,
    action,
    entity,
    entity_id: entityId,
    meta: sanitizedMeta,
    ip,
    created_at: new Date().toISOString(),
  };
}

/**
 * Mencatat audit log secara non-blocking / fail-safe agar kegagalan penulisan log
 * tidak menggagalkan transaksi utama pengguna.
 */
export async function recordAuditLogSafe(
  input: AuditLogInput
): Promise<AuditLogItem | null> {
  try {
    return await recordAuditLog(input);
  } catch (err) {
    console.error("[AuditService] Failed to record audit log:", err);
    return null;
  }
}

/**
 * Mengambil daftar audit log dengan filter dan paginasi (khusus Admin).
 */
export async function listAuditLogs(filters?: ListAuditLogsFilters): Promise<{
  data: AuditLogItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}> {
  await ensureAuditLogsTable();

  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (
    filters?.actor_user_id !== undefined &&
    filters.actor_user_id !== null &&
    String(filters.actor_user_id).trim() !== ""
  ) {
    const actorId = Number(String(filters.actor_user_id).trim());
    if (Number.isSafeInteger(actorId) && actorId > 0) {
      whereClauses.push(" AND actor_user_id = ?");
      params.push(actorId);
    }
  }

  if (typeof filters?.action === "string" && filters.action.trim() !== "") {
    whereClauses.push(" AND action = ?");
    params.push(filters.action.trim());
  }

  if (typeof filters?.entity === "string" && filters.entity.trim() !== "") {
    whereClauses.push(" AND entity = ?");
    params.push(filters.entity.trim());
  }

  if (
    filters?.entity_id !== undefined &&
    filters.entity_id !== null &&
    String(filters.entity_id).trim() !== ""
  ) {
    whereClauses.push(" AND entity_id = ?");
    params.push(String(filters.entity_id).trim());
  }

  if (
    typeof filters?.from === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(filters.from.trim())
  ) {
    whereClauses.push(" AND DATE(created_at) >= ?");
    params.push(filters.from.trim());
  }

  if (
    typeof filters?.to === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(filters.to.trim())
  ) {
    whereClauses.push(" AND DATE(created_at) <= ?");
    params.push(filters.to.trim());
  }

  const rawPage = Number(filters?.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawLimit = Number(filters?.limit ?? 20);
  const limit =
    Number.isSafeInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 100)
      : 20;
  const offset = (page - 1) * limit;

  const whereSql = `WHERE 1 = 1${whereClauses.join("")}`;

  const [countRows] = await database.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total ?? 0);
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT id, actor_user_id, action, entity, entity_id, meta, ip, created_at
     FROM audit_logs
     ${whereSql}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(mapAuditRow),
    meta: {
      page,
      limit,
      total,
      total_pages: totalPages,
    },
  };
}

export const AuditService = {
  ensureAuditLogsTable,
  sanitizeAuditMeta,
  log: recordAuditLog,
  logSafe: recordAuditLogSafe,
  list: listAuditLogs,
};
