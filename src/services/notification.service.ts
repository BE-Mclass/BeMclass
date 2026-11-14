import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";

export type NotificationType =
  | "attendance_recorded"
  | "outside_radius_attempt"
  | "attendance_alpa"
  | "leave_submitted"
  | "leave_approved"
  | "leave_rejected"
  | "announcement"
  | (string & {});

export interface NotificationItem {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  is_read: boolean;
  created_at: string;
}

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

interface NotificationRow extends RowDataPacket {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body: string;
  data: string | Record<string, unknown> | null;
  read_at: Date | string | null;
  created_at: Date | string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface RecipientRow extends RowDataPacket {
  user_id: number;
}

let notificationsTableChecked = false;

async function ensureNotificationsTable(): Promise<void> {
  if (notificationsTableChecked) {
    return;
  }
  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        type VARCHAR(40) NOT NULL,
        title VARCHAR(150) NOT NULL,
        body VARCHAR(500) NOT NULL,
        data JSON NULL,
        read_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_notif_user (user_id, read_at, created_at),
        CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    notificationsTableChecked = true;
  } catch {
    notificationsTableChecked = true;
  }
}

export function resetNotificationsTableCheckForTesting(): void {
  notificationsTableChecked = true;
}

function toIsoStringOrNull(val: Date | string | null | undefined): string | null {
  if (!val) {
    return null;
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
  return null;
}

function parseJsonColumn(
  raw: string | Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "object") {
    return raw;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function mapNotificationRow(row: NotificationRow): NotificationItem {
  const readAt = toIsoStringOrNull(row.read_at);
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    type: row.type,
    title: row.title,
    body: row.body,
    data: parseJsonColumn(row.data),
    read_at: readAt,
    is_read: readAt !== null,
    created_at: toIsoStringOrNull(row.created_at) ?? new Date().toISOString(),
  };
}

/**
 * US-60 & FSD §5.9 — GET /api/notifications?unread=&type=&page=&per_page=
 * Mengambil daftar notifikasi in-app milik pengguna yang sedang login.
 */
export async function listUserNotifications(
  userId: number,
  filters?: {
    unread?: unknown;
    type?: unknown;
    page?: unknown;
    perPage?: unknown;
  }
): Promise<{
  items: NotificationItem[];
  unread_count: number;
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}> {
  await ensureNotificationsTable();

  let whereSql = `WHERE user_id = ?`;
  const params: Array<string | number> = [userId];

  if (filters?.unread !== undefined && filters.unread !== "") {
    const rawUnread = String(filters.unread).trim().toLowerCase();
    if (rawUnread === "true" || rawUnread === "1") {
      whereSql += ` AND read_at IS NULL`;
    } else if (rawUnread === "false" || rawUnread === "0") {
      whereSql += ` AND read_at IS NOT NULL`;
    } else {
      throw new AppError("Filter unread tidak valid.", 400, {
        code: "VALIDATION_ERROR",
        errors: { unread: "Gunakan true/false atau 1/0." },
      });
    }
  }

  if (typeof filters?.type === "string" && filters.type.trim() !== "") {
    whereSql += ` AND type = ?`;
    params.push(filters.type.trim());
  }

  const rawPage =
    filters?.page !== undefined && filters.page !== ""
      ? Number(filters.page)
      : 1;
  const rawPerPage =
    filters?.perPage !== undefined && filters.perPage !== ""
      ? Number(filters.perPage)
      : 20;

  if (!Number.isSafeInteger(rawPage) || rawPage < 1) {
    throw new AppError("Parameter halaman tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { page: "Nomor halaman harus berupa bilangan bulat positif." },
    });
  }
  if (!Number.isSafeInteger(rawPerPage) || rawPerPage < 1 || rawPerPage > 100) {
    throw new AppError("Parameter batas data per halaman tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { per_page: "Jumlah per halaman harus antara 1 hingga 100." },
    });
  }

  const offset = (rawPage - 1) * rawPerPage;

  const [countRows] = await database.execute<CountRow[]>(
    `SELECT COUNT(*) AS total FROM notifications ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await database.execute<NotificationRow[]>(
    `SELECT id, user_id, type, title, body, data, read_at, created_at
     FROM notifications
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, rawPerPage, offset]
  );

  const unreadInfo = await getUnreadNotificationCount(userId);

  return {
    items: rows.map(mapNotificationRow),
    unread_count: unreadInfo.unread_count,
    pagination: {
      page: rawPage,
      per_page: rawPerPage,
      total,
      total_pages: Math.max(1, Math.ceil(total / rawPerPage)),
    },
  };
}

/**
 * US-60 AC2 & FSD §5.9 — GET /api/notifications/unread-count
 * Mengembalikan jumlah notifikasi yang belum dibaca untuk badge UI.
 */
export async function getUnreadNotificationCount(userId: number): Promise<{
  unread_count: number;
  count: number;
}> {
  await ensureNotificationsTable();

  const [rows] = await database.execute<CountRow[]>(
    `SELECT COUNT(*) AS total
     FROM notifications
     WHERE user_id = ? AND read_at IS NULL`,
    [userId]
  );

  const count = Number(rows[0]?.total ?? 0);
  return {
    unread_count: count,
    count,
  };
}

/**
 * US-60 & FSD §5.9 — PATCH /api/notifications/:id/read
 * Menandai satu notifikasi milik pengguna sebagai sudah dibaca.
 * Sesuai FSD §2: akses ke notifikasi milik pengguna lain mengembalikan 404 NOT_FOUND.
 */
export async function markNotificationAsRead(
  userId: number,
  notificationId: number
): Promise<NotificationItem> {
  await ensureNotificationsTable();

  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
    throw new AppError("ID notifikasi tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { id: "ID notifikasi harus berupa bilangan bulat positif." },
    });
  }

  const [existingRows] = await database.execute<NotificationRow[]>(
    `SELECT id, user_id, type, title, body, data, read_at, created_at
     FROM notifications
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [notificationId, userId]
  );

  if (existingRows.length === 0) {
    throw new AppError("Notifikasi tidak ditemukan.", 404, {
      code: "NOT_FOUND",
    });
  }

  if (existingRows[0].read_at === null) {
    await database.execute(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = ? AND user_id = ?`,
      [notificationId, userId]
    );
  }

  const [updatedRows] = await database.execute<NotificationRow[]>(
    `SELECT id, user_id, type, title, body, data, read_at, created_at
     FROM notifications
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [notificationId, userId]
  );

  return mapNotificationRow(updatedRows[0] ?? existingRows[0]);
}

/**
 * US-60 AC1 & FSD §5.9 — POST /api/notifications/read-all
 * Menandai seluruh notifikasi belum dibaca milik pengguna sebagai sudah dibaca.
 */
export async function markAllNotificationsAsRead(userId: number): Promise<{
  updated_count: number;
  unread_count: number;
}> {
  await ensureNotificationsTable();

  const [result] = await database.execute<ResultSetHeader>(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE user_id = ? AND read_at IS NULL`,
    [userId]
  );

  return {
    updated_count: Number(result?.affectedRows ?? 0),
    unread_count: 0,
  };
}

/**
 * Fungsi internal pembuat 1 notifikasi in-app.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<NotificationItem> {
  await ensureNotificationsTable();

  const title = input.title.trim().slice(0, 150);
  const body = input.body.trim().slice(0, 500);
  const dataJson = input.data ? JSON.stringify(input.data) : null;

  const [result] = await database.execute<ResultSetHeader>(
    `INSERT INTO notifications (user_id, type, title, body, data)
     VALUES (?, ?, ?, ?, ?)`,
    [input.userId, input.type, title, body, dataJson]
  );

  const [rows] = await database.execute<NotificationRow[]>(
    `SELECT id, user_id, type, title, body, data, read_at, created_at
     FROM notifications
     WHERE id = ?
     LIMIT 1`,
    [result.insertId]
  );

  if (rows.length > 0) {
    return mapNotificationRow(rows[0]);
  }

  return {
    id: Number(result.insertId),
    user_id: input.userId,
    type: input.type,
    title,
    body,
    data: input.data ?? null,
    read_at: null,
    is_read: false,
    created_at: new Date().toISOString(),
  };
}

/**
 * Fungsi internal pembuat banyak notifikasi sekaligus (bulk insert) untuk daftar user_id.
 */
export async function createBulkNotifications(
  userIds: number[],
  payload: {
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown> | null;
  }
): Promise<number> {
  await ensureNotificationsTable();

  const uniqueUserIds = Array.from(
    new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0))
  );
  if (uniqueUserIds.length === 0) {
    return 0;
  }

  const title = payload.title.trim().slice(0, 150);
  const body = payload.body.trim().slice(0, 500);
  const dataJson = payload.data ? JSON.stringify(payload.data) : null;

  let inserted = 0;
  for (const uid of uniqueUserIds) {
    await database.execute<ResultSetHeader>(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES (?, ?, ?, ?, ?)`,
      [uid, payload.type, title, body, dataJson]
    );
    inserted++;
  }
  return inserted;
}

/**
 * Helper internal berdasarkan aturan bisnis BR-50a..f (FSD §3.7)
 */
export const NotificationService = {
  create: createNotification,
  createBulk: createBulkNotifications,

  /**
   * BR-50a — Presensi tercatat -> siswa (`attendance_recorded`)
   */
  async notifyAttendanceRecorded(params: {
    studentUserId: number;
    recordId: number;
    status: "hadir" | "terlambat";
    date: string;
    lateMinutes?: number | null;
  }): Promise<void> {
    try {
      const isLate = params.status === "terlambat";
      const title = isLate
        ? "Presensi Tercatat (Terlambat)"
        : "Presensi Masuk Berhasil";
      const body = isLate
        ? `Presensi masuk tanggal ${params.date} tercatat terlambat${params.lateMinutes ? ` ${params.lateMinutes} menit` : ""}.`
        : `Presensi masuk Anda pada tanggal ${params.date} berhasil tercatat tepat waktu.`;

      await createNotification({
        userId: params.studentUserId,
        type: "attendance_recorded",
        title,
        body,
        data: {
          record_id: params.recordId,
          status: params.status,
          date: params.date,
        },
      });
    } catch (err) {
      console.error("[NOTIFICATION] Failed BR-50a:", err);
    }
  },

  /**
   * BR-50b — Percobaan presensi ditolak di luar radius -> siswa (`outside_radius_attempt`)
   */
  async notifyOutsideRadiusAttempt(params: {
    studentUserId: number;
    attemptId?: number | null;
    distanceM: number;
    radiusM: number;
  }): Promise<void> {
    try {
      await createNotification({
        userId: params.studentUserId,
        type: "outside_radius_attempt",
        title: "Presensi Ditolak: Di Luar Radius",
        body: `Lokasi Anda berjarak ${Math.round(params.distanceM)}m dari titik sekolah (batas radius ${params.radiusM}m).`,
        data: {
          attempt_id: params.attemptId ?? null,
          distance_m: Math.round(params.distanceM),
          radius_m: params.radiusM,
        },
      });
    } catch (err) {
      console.error("[NOTIFICATION] Failed BR-50b:", err);
    }
  },

  /**
   * BR-50c — Siswa ditandai Alpa oleh job otomatis -> siswa (`attendance_alpa`)
   */
  async notifyAttendanceAlpa(params: {
    studentUserId: number;
    recordId: number;
    date: string;
  }): Promise<void> {
    try {
      await createNotification({
        userId: params.studentUserId,
        type: "attendance_alpa",
        title: "Status Kehadiran: Alpa",
        body: `Anda tercatat Alpa (Tanpa Keterangan) pada tanggal ${params.date} karena belum melakukan presensi hingga batas waktu ditutup.`,
        data: {
          record_id: params.recordId,
          status: "alpa",
          date: params.date,
        },
      });
    } catch (err) {
      console.error("[NOTIFICATION] Failed BR-50c:", err);
    }
  },

  /**
   * BR-50d — Surat izin diajukan -> wali kelas siswa (jika ada; jika tidak, semua guru & admin) (`leave_submitted`)
   */
  async notifyLeaveSubmitted(params: {
    leaveRequestId: number;
    studentRosterId: number;
    studentName: string;
    category: string;
    startDate: string;
    endDate: string;
  }): Promise<number> {
    try {
      // Cari homeroom_teacher_id dari kelas siswa
      const [homeroomRows] = await database.execute<RecipientRow[]>(
        `SELECT u.id AS user_id
         FROM student_roster sr
         INNER JOIN classes c ON c.id = sr.class_id
         INNER JOIN users u ON u.id = c.homeroom_teacher_id
         WHERE sr.id = ? AND u.is_active = 1
         LIMIT 1`,
        [params.studentRosterId]
      );

      let recipientIds: number[] = [];
      if (homeroomRows.length > 0 && homeroomRows[0].user_id) {
        recipientIds = [Number(homeroomRows[0].user_id)];
      } else {
        // Fallback: semua guru & admin aktif
        const [staffRows] = await database.execute<RecipientRow[]>(
          `SELECT id AS user_id
           FROM users
           WHERE role IN ('admin', 'guru') AND is_active = 1`
        );
        recipientIds = staffRows.map((r) => Number(r.user_id));
      }

      return await createBulkNotifications(recipientIds, {
        type: "leave_submitted",
        title: `Pengajuan Izin Baru: ${params.studentName}`,
        body: `${params.studentName} mengajukan surat izin (${params.category}) untuk tanggal ${params.startDate} s.d. ${params.endDate}.`,
        data: {
          leave_request_id: params.leaveRequestId,
          student_id: params.studentRosterId,
          category: params.category,
          start_date: params.startDate,
          end_date: params.endDate,
        },
      });
    } catch (err) {
      console.error("[NOTIFICATION] Failed BR-50d:", err);
      return 0;
    }
  },

  /**
   * BR-50e — Surat izin disetujui / ditolak -> siswa (`leave_approved` / `leave_rejected`)
   */
  async notifyLeaveReviewed(params: {
    studentUserId: number;
    leaveRequestId: number;
    status: "disetujui" | "ditolak";
    startDate: string;
    endDate: string;
    reviewNote?: string | null;
  }): Promise<void> {
    try {
      const approved = params.status === "disetujui";
      const type = approved ? "leave_approved" : "leave_rejected";
      const title = approved
        ? "Surat Izin Disetujui"
        : "Surat Izin Ditolak";
      const body = approved
        ? `Pengajuan izin Anda untuk tanggal ${params.startDate} s.d. ${params.endDate} telah disetujui.`
        : `Pengajuan izin Anda untuk tanggal ${params.startDate} s.d. ${params.endDate} ditolak.${params.reviewNote ? ` Catatan: ${params.reviewNote}` : ""}`;

      await createNotification({
        userId: params.studentUserId,
        type,
        title,
        body,
        data: {
          leave_request_id: params.leaveRequestId,
          status: params.status,
          start_date: params.startDate,
          end_date: params.endDate,
          review_note: params.reviewNote ?? null,
        },
      });
    } catch (err) {
      console.error("[NOTIFICATION] Failed BR-50e:", err);
    }
  },

  /**
   * BR-50f, BR-40 & BR-44 — Pengumuman penting/urgent terbit -> audiens sesuai BR-40 (`announcement`)
   * Target `wali` tidak menghasilkan notifikasi (D-13).
   */
  async notifyAnnouncementPublished(params: {
    announcementId: number;
    title: string;
    description: string;
    category: string;
    priority: string;
    targetAudience: "all" | "siswa" | "guru" | "wali";
    classId?: number | null;
  }): Promise<number> {
    try {
      // BR-44: hanya prioritas penting/important atau urgent (atau kategori important/penting)
      const isImportantPriority =
        params.priority === "important" ||
        params.priority === "penting" ||
        params.priority === "urgent";
      const isImportantCategory =
        params.category === "important" || params.category === "penting";

      if (!isImportantPriority && !isImportantCategory) {
        return 0;
      }

      // D-13 & BR-40: target wali disimpan tetapi tidak menghasilkan notifikasi
      if (params.targetAudience === "wali") {
        return 0;
      }

      const recipientIds: number[] = [];

      if (
        params.targetAudience === "guru" ||
        params.targetAudience === "all"
      ) {
        const [staffRows] = await database.execute<RecipientRow[]>(
          `SELECT id AS user_id
           FROM users
           WHERE role IN ('admin', 'guru') AND is_active = 1`
        );
        for (const r of staffRows) {
          recipientIds.push(Number(r.user_id));
        }
      }

      if (
        params.targetAudience === "siswa" ||
        params.targetAudience === "all"
      ) {
        if (params.classId) {
          const [studentRows] = await database.execute<RecipientRow[]>(
            `SELECT sr.user_id
             FROM student_roster sr
             INNER JOIN users u ON u.id = sr.user_id
             WHERE sr.class_id = ?
               AND sr.is_active = 1
               AND sr.user_id IS NOT NULL
               AND u.is_active = 1`,
            [params.classId]
          );
          for (const r of studentRows) {
            recipientIds.push(Number(r.user_id));
          }
        } else {
          const [studentRows] = await database.execute<RecipientRow[]>(
            `SELECT id AS user_id
             FROM users
             WHERE role = 'siswa' AND is_active = 1`
          );
          for (const r of studentRows) {
            recipientIds.push(Number(r.user_id));
          }
        }
      }

      const snippet =
        params.description.length > 180
          ? `${params.description.slice(0, 177)}...`
          : params.description;

      return await createBulkNotifications(recipientIds, {
        type: "announcement",
        title: `Pengumuman Penting: ${params.title}`,
        body: snippet,
        data: {
          announcement_id: params.announcementId,
          priority: params.priority,
          category: params.category,
          class_id: params.classId ?? null,
        },
      });
    } catch (err) {
      console.error("[NOTIFICATION] Failed BR-50f:", err);
      return 0;
    }
  },
};
