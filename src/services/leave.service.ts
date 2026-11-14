import path from "path";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { UserRole } from "../types/auth.types";
import { AppError } from "../utils/errors";
import { saveLeaveAttachmentFile } from "../utils/leave-upload";
import { createSignedFileUrl } from "../utils/signed-url";
import { getDayOfWeekIso, nowUtc, toWibDate } from "../utils/wib-time";
import { NotificationService } from "./notification.service";

export type LeaveCategory = "sakit" | "keperluan" | "dispensasi";
export type LeaveStatus = "menunggu" | "disetujui" | "ditolak" | "dibatalkan";

const VALID_CATEGORIES: Record<string, LeaveCategory> = {
  sakit: "sakit",
  keperluan: "keperluan",
  izin: "keperluan",
  dispensasi: "dispensasi",
};

const CATEGORY_LABELS: Record<LeaveCategory, string> = {
  sakit: "Sakit",
  keperluan: "Keperluan",
  dispensasi: "Dispensasi",
};

const STATUS_LABELS: Record<LeaveStatus, string> = {
  menunggu: "Menunggu",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  dibatalkan: "Dibatalkan",
};

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LEAVE_MAX_DAYS = Number(process.env.LEAVE_MAX_DAYS ?? 14);
const DEFAULT_LEAVE_MAX_BACKDATE_DAYS = Number(
  process.env.LEAVE_MAX_BACKDATE_DAYS ?? 3
);

export interface LeaveRequestItem {
  id: number;
  student_id: number;
  category: LeaveCategory;
  category_label: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  status_label: string;
  attachment_url: string;
  attachment_mime: string;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  student: {
    id: number;
    user_id: number | null;
    nisn: string;
    name: string;
    class: {
      id: number;
      name: string;
      grade_level: number | null;
    } | null;
  };
}

interface LeaveRow extends RowDataPacket {
  id: number;
  student_id: number;
  category: LeaveCategory;
  start_date: string | Date;
  end_date: string | Date;
  reason: string;
  attachment_path: string;
  attachment_mime: string;
  status: LeaveStatus;
  reviewed_by: number | null;
  reviewed_at: Date | string | null;
  review_note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  student_user_id: number | null;
  nisn: string;
  student_name: string;
  class_id: number | null;
  class_name: string | null;
  grade_level: number | null;
  reviewer_name: string | null;
}

interface CountRow extends RowDataPacket {
  total: number;
}

let leaveTableChecked = false;

async function ensureLeaveRequestsTable(): Promise<void> {
  if (leaveTableChecked) {
    return;
  }
  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_id BIGINT UNSIGNED NOT NULL COMMENT 'References student_roster(id)',
        category ENUM('sakit', 'keperluan', 'dispensasi') NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason TEXT NOT NULL,
        attachment_path VARCHAR(255) NOT NULL,
        attachment_mime VARCHAR(60) NOT NULL,
        status ENUM('menunggu', 'disetujui', 'ditolak', 'dibatalkan') NOT NULL DEFAULT 'menunggu',
        reviewed_by BIGINT UNSIGNED NULL,
        reviewed_at DATETIME NULL,
        review_note VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_leave_student_dates (student_id, start_date, end_date),
        INDEX idx_leave_status_created (status, created_at),
        CONSTRAINT fk_leave_student FOREIGN KEY (student_id) REFERENCES student_roster(id) ON DELETE CASCADE,
        CONSTRAINT fk_leave_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    leaveTableChecked = true;
  } catch {
    leaveTableChecked = true;
  }
}

export function resetLeaveTableCheckForTesting(): void {
  leaveTableChecked = true;
}

function formatDateYmd(val: Date | string): string {
  if (typeof val === "string") {
    return val.slice(0, 10);
  }
  const y = val.getFullYear();
  const m = String(val.getMonth() + 1).padStart(2, "0");
  const d = String(val.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

function isValidCalendarDate(ymd: string): boolean {
  if (!DATE_REGEX.test(ymd)) {
    return false;
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Menghitung jumlah hari kalender inklusif antara startYmd dan endYmd.
 */
export function calculateInclusiveDays(startYmd: string, endYmd: string): number {
  const [sy, sm, sd] = startYmd.split("-").map(Number);
  const [ey, em, ed] = endYmd.split("-").map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  return Math.floor((endUtc - startUtc) / (24 * 3600 * 1000)) + 1;
}

/**
 * Menghasilkan daftar seluruh tanggal YYYY-MM-DD inklusif dalam rentang [startYmd..endYmd].
 */
export function enumerateDatesBetween(
  startYmd: string,
  endYmd: string
): string[] {
  const [sy, sm, sd] = startYmd.split("-").map(Number);
  const [ey, em, ed] = endYmd.split("-").map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  const dates: string[] = [];
  for (let ms = startUtc; ms <= endUtc; ms += 24 * 3600 * 1000) {
    const dt = new Date(ms);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
  }
  return dates;
}

function mapLeaveRow(row: LeaveRow): LeaveRequestItem {
  const startDate = formatDateYmd(row.start_date);
  const endDate = formatDateYmd(row.end_date);
  const days = calculateInclusiveDays(startDate, endDate);
  const filename = path.basename(row.attachment_path);
  const signedUrl = createSignedFileUrl({ category: "leaves", filename });

  return {
    id: Number(row.id),
    student_id: Number(row.student_id),
    category: row.category,
    category_label: CATEGORY_LABELS[row.category] ?? row.category,
    start_date: startDate,
    end_date: endDate,
    days,
    reason: row.reason,
    status: row.status,
    status_label: STATUS_LABELS[row.status] ?? row.status,
    attachment_url: signedUrl,
    attachment_mime: row.attachment_mime,
    reviewed_by: row.reviewed_by !== null ? Number(row.reviewed_by) : null,
    reviewer_name: row.reviewer_name ?? null,
    reviewed_at: toIsoStringOrNull(row.reviewed_at),
    review_note: row.review_note ?? null,
    created_at: toIsoStringOrNull(row.created_at) ?? new Date().toISOString(),
    updated_at: toIsoStringOrNull(row.updated_at) ?? new Date().toISOString(),
    student: {
      id: Number(row.student_id),
      user_id:
        row.student_user_id !== null && row.student_user_id !== undefined
          ? Number(row.student_user_id)
          : null,
      nisn: row.nisn,
      name: row.student_name,
      class:
        row.class_id !== null && row.class_id !== undefined
          ? {
              id: Number(row.class_id),
              name: row.class_name ?? "",
              grade_level:
                row.grade_level !== null && row.grade_level !== undefined
                  ? Number(row.grade_level)
                  : null,
            }
          : null,
    },
  };
}

/**
 * Mengecek apakah suatu tanggal YYYY-MM-DD adalah hari sekolah aktif (BR-10 & BR-23).
 */
async function isSchoolDayForLeave(dateYmd: string): Promise<boolean> {
  const dayOfWeek = getDayOfWeekIso(dateYmd);

  const [schedRows] = await database.execute<RowDataPacket[]>(
    `SELECT is_school_day
     FROM attendance_schedules
     WHERE day_of_week = ?
     LIMIT 1`,
    [dayOfWeek]
  );

  // Jika jadwal ditemukan dan is_school_day = 0, maka bukan hari sekolah.
  // Jika jadwal belum di-seed, Minggu (7) dianggap libur.
  if (schedRows.length > 0) {
    if (!schedRows[0].is_school_day) {
      return false;
    }
  } else if (dayOfWeek === 7) {
    return false;
  }

  // Cek apakah ada pengumuman libur (category = 'holiday', status = 'published') yang mencakup tanggal tersebut (BR-10)
  const [holidayRows] = await database.execute<RowDataPacket[]>(
    `SELECT id
     FROM announcements
     WHERE category = 'holiday'
       AND status = 'published'
       AND deleted_at IS NULL
       AND publish_date <= ?
       AND COALESCE(end_date, publish_date) >= ?
     LIMIT 1`,
    [dateYmd, dateYmd]
  );

  return holidayRows.length === 0;
}

/**
 * US-20, BR-21, BR-22, BR-50d & FSD §5.5 — POST /api/leave-requests
 * Siswa mengajukan surat izin digital beserta lampiran (PDF/JPG/PNG <= 5 MB).
 */
export async function createLeaveRequest(params: {
  studentRosterId: number;
  fields: Record<string, string>;
  attachment: {
    buffer: Buffer;
    ext: "pdf" | "jpg" | "png";
    mime: "application/pdf" | "image/jpeg" | "image/png";
  };
  todayOverrideWib?: string;
}): Promise<LeaveRequestItem> {
  await ensureLeaveRequestsTable();

  const { fields, attachment, studentRosterId } = params;
  const errors: Record<string, string> = {};

  const rawCategory = (
    fields.category ??
    fields.type ??
    fields.jenis ??
    ""
  )
    .trim()
    .toLowerCase();
  const category = VALID_CATEGORIES[rawCategory];
  if (!category) {
    errors.category =
      "Kategori izin tidak valid. Pilih 'sakit', 'keperluan', atau 'dispensasi'.";
  }

  const startDate = (
    fields.start_date ??
    fields.startDate ??
    fields.from_date ??
    ""
  ).trim();
  const endDate = (
    fields.end_date ??
    fields.endDate ??
    fields.to_date ??
    startDate
  ).trim();

  if (!startDate || !isValidCalendarDate(startDate)) {
    errors.start_date =
      "Tanggal mulai wajib diisi dengan format YYYY-MM-DD yang valid.";
  }
  if (!endDate || !isValidCalendarDate(endDate)) {
    errors.end_date =
      "Tanggal selesai wajib diisi dengan format YYYY-MM-DD yang valid.";
  }

  const reason = (
    fields.reason ??
    fields.keterangan ??
    fields.description ??
    fields.note ??
    ""
  ).trim();
  if (!reason) {
    errors.reason = "Keterangan/alasan surat izin wajib diisi.";
  } else if (reason.length < 5) {
    errors.reason = "Keterangan surat izin minimal 5 karakter.";
  } else if (reason.length > 1000) {
    errors.reason = "Keterangan surat izin maksimal 1000 karakter.";
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi pengajuan surat izin gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  // BR-22: Validasi rentang tanggal (start_date <= end_date, maks 14 hari, maks backdate 3 hari)
  if (endDate < startDate) {
    throw new AppError(
      "Tanggal selesai tidak boleh lebih awal dari tanggal mulai.",
      422,
      {
        code: "LEAVE_RANGE_INVALID",
        errors: {
          end_date: "Tanggal selesai harus sama atau setelah tanggal mulai.",
        },
      }
    );
  }

  const totalDays = calculateInclusiveDays(startDate, endDate);
  if (totalDays > DEFAULT_LEAVE_MAX_DAYS) {
    throw new AppError(
      `Rentang surat izin maksimal ${DEFAULT_LEAVE_MAX_DAYS} hari.`,
      422,
      {
        code: "LEAVE_RANGE_INVALID",
        errors: {
          end_date: `Durasi izin tidak boleh melebihi ${DEFAULT_LEAVE_MAX_DAYS} hari.`,
        },
      }
    );
  }

  const todayWib = params.todayOverrideWib ?? toWibDate(nowUtc());
  if (startDate < todayWib) {
    const backdateDays = calculateInclusiveDays(startDate, todayWib) - 1;
    if (backdateDays > DEFAULT_LEAVE_MAX_BACKDATE_DAYS) {
      throw new AppError(
        `Pengajuan izin berlaku surut maksimal ${DEFAULT_LEAVE_MAX_BACKDATE_DAYS} hari ke belakang.`,
        422,
        {
          code: "LEAVE_RANGE_INVALID",
          errors: {
            start_date: `Tanggal mulai maksimal ${DEFAULT_LEAVE_MAX_BACKDATE_DAYS} hari ke belakang dari hari ini.`,
          },
        }
      );
    }
  }

  // BR-22: Cek tumpang tindih (overlap) dengan surat izin berstatus 'menunggu' atau 'disetujui' milik siswa yang sama
  const [overlapRows] = await database.execute<RowDataPacket[]>(
    `SELECT id, start_date, end_date, status
     FROM leave_requests
     WHERE student_id = ?
       AND status IN ('menunggu', 'disetujui')
       AND start_date <= ?
       AND end_date >= ?
     LIMIT 1`,
    [studentRosterId, endDate, startDate]
  );

  if (overlapRows.length > 0) {
    throw new AppError(
      "Rentang tanggal surat izin bertabrakan dengan pengajuan izin aktif lainnya.",
      409,
      { code: "LEAVE_OVERLAP" }
    );
  }

  // Simpan file lampiran ke disk
  const savedFile = saveLeaveAttachmentFile(attachment.buffer, attachment.ext);

  const [result] = await database.execute<ResultSetHeader>(
    `INSERT INTO leave_requests
       (student_id, category, start_date, end_date, reason, attachment_path, attachment_mime, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'menunggu')`,
    [
      studentRosterId,
      category,
      startDate,
      endDate,
      reason,
      savedFile.relativePath,
      attachment.mime,
    ]
  );

  const created = await getLeaveRequestById({
    id: result.insertId,
    role: "siswa",
    studentRosterId,
  });

  // BR-50d: Kirim notifikasi ke wali kelas siswa (atau semua guru & admin bila belum ada wali kelas)
  await NotificationService.notifyLeaveSubmitted({
    leaveRequestId: created.id,
    studentRosterId,
    studentName: created.student.name,
    category: created.category_label,
    startDate: created.start_date,
    endDate: created.end_date,
  });

  return created;
}

/**
 * US-20 & US-21, FSD §5.5 — GET /api/leave-requests
 * Siswa hanya melihat surat izin miliknya; Guru/Admin melihat semua dengan filter.
 */
export async function listLeaveRequests(params: {
  role: UserRole;
  studentRosterId?: number | null;
  filters?: {
    status?: unknown;
    category?: unknown;
    class_id?: unknown;
    nisn?: unknown;
    from?: unknown;
    to?: unknown;
    page?: unknown;
    limit?: unknown;
  };
}): Promise<{
  items: LeaveRequestItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}> {
  await ensureLeaveRequestsTable();

  let whereSql = `WHERE 1 = 1`;
  const sqlParams: Array<string | number> = [];

  if (params.role === "siswa") {
    if (!params.studentRosterId) {
      throw new AppError("Profil roster siswa tidak ditemukan.", 404, {
        code: "ROSTER_NOT_FOUND",
      });
    }
    whereSql += ` AND lr.student_id = ?`;
    sqlParams.push(params.studentRosterId);
  } else {
    // Filter khusus staf (guru/admin): class_id & nisn
    const rawClassId = params.filters?.class_id;
    if (
      rawClassId !== undefined &&
      rawClassId !== "" &&
      /^\d+$/.test(String(rawClassId).trim())
    ) {
      whereSql += ` AND sr.class_id = ?`;
      sqlParams.push(Number(String(rawClassId).trim()));
    }

    const rawNisn = params.filters?.nisn;
    if (typeof rawNisn === "string" && rawNisn.trim() !== "") {
      whereSql += ` AND sr.nisn = ?`;
      sqlParams.push(rawNisn.trim());
    }
  }

  const rawStatus = params.filters?.status;
  if (typeof rawStatus === "string" && rawStatus.trim() !== "") {
    whereSql += ` AND lr.status = ?`;
    sqlParams.push(rawStatus.trim().toLowerCase());
  }

  const rawCategory = params.filters?.category;
  if (typeof rawCategory === "string" && rawCategory.trim() !== "") {
    const mappedCat = VALID_CATEGORIES[rawCategory.trim().toLowerCase()];
    if (mappedCat) {
      whereSql += ` AND lr.category = ?`;
      sqlParams.push(mappedCat);
    }
  }

  const rawFrom = params.filters?.from;
  if (
    typeof rawFrom === "string" &&
    rawFrom.trim() !== "" &&
    isValidCalendarDate(rawFrom.trim())
  ) {
    whereSql += ` AND lr.end_date >= ?`;
    sqlParams.push(rawFrom.trim());
  }

  const rawTo = params.filters?.to;
  if (
    typeof rawTo === "string" &&
    rawTo.trim() !== "" &&
    isValidCalendarDate(rawTo.trim())
  ) {
    whereSql += ` AND lr.start_date <= ?`;
    sqlParams.push(rawTo.trim());
  }

  const page =
    params.filters?.page !== undefined && params.filters.page !== ""
      ? Number(params.filters.page)
      : 1;
  const limit =
    params.filters?.limit !== undefined && params.filters.limit !== ""
      ? Number(params.filters.limit)
      : 20;

  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AppError("Parameter page tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { page: "Nomor halaman harus berupa bilangan bulat positif." },
    });
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("Parameter limit tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { limit: "Limit per halaman harus antara 1 hingga 100." },
    });
  }

  const offset = (page - 1) * limit;

  const [countRows] = await database.execute<CountRow[]>(
    `SELECT COUNT(*) AS total
     FROM leave_requests lr
     INNER JOIN student_roster sr ON sr.id = lr.student_id
     ${whereSql}`,
    sqlParams
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await database.execute<LeaveRow[]>(
    `SELECT
       lr.*,
       sr.user_id AS student_user_id,
       sr.nisn,
       sr.full_name AS student_name,
       sr.class_id,
       c.name AS class_name,
       c.grade_level,
       rev.name AS reviewer_name
     FROM leave_requests lr
     INNER JOIN student_roster sr ON sr.id = lr.student_id
     LEFT JOIN classes c ON c.id = sr.class_id
     LEFT JOIN users rev ON rev.id = lr.reviewed_by
     ${whereSql}
     ORDER BY lr.created_at DESC, lr.id DESC
     LIMIT ? OFFSET ?`,
    [...sqlParams, limit, offset]
  );

  return {
    items: rows.map(mapLeaveRow),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/**
 * US-20 & US-21, FSD §5.5 — GET /api/leave-requests/:id
 * Mengambil detail surat izin (beserta attachment_path mentah untuk keperluan streaming).
 * Akses lintas-siswa mengembalikan 404 NOT_FOUND (FSD §2).
 */
export async function getLeaveRequestRawRowById(params: {
  id: number;
  role: UserRole;
  studentRosterId?: number | null;
}): Promise<LeaveRow> {
  await ensureLeaveRequestsTable();

  if (!Number.isSafeInteger(params.id) || params.id <= 0) {
    throw new AppError("ID surat izin tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { id: "ID surat izin harus berupa bilangan bulat positif." },
    });
  }

  const [rows] = await database.execute<LeaveRow[]>(
    `SELECT
       lr.*,
       sr.user_id AS student_user_id,
       sr.nisn,
       sr.full_name AS student_name,
       sr.class_id,
       c.name AS class_name,
       c.grade_level,
       rev.name AS reviewer_name
     FROM leave_requests lr
     INNER JOIN student_roster sr ON sr.id = lr.student_id
     LEFT JOIN classes c ON c.id = sr.class_id
     LEFT JOIN users rev ON rev.id = lr.reviewed_by
     WHERE lr.id = ?
     LIMIT 1`,
    [params.id]
  );

  if (rows.length === 0) {
    throw new AppError("Surat izin tidak ditemukan.", 404, {
      code: "NOT_FOUND",
    });
  }

  const row = rows[0];

  // FSD §2: Siswa hanya boleh mengakses surat izin miliknya sendiri; milik siswa lain -> 404 NOT_FOUND
  if (
    params.role === "siswa" &&
    (!params.studentRosterId || Number(row.student_id) !== params.studentRosterId)
  ) {
    throw new AppError("Surat izin tidak ditemukan.", 404, {
      code: "NOT_FOUND",
    });
  }

  return row;
}

export async function getLeaveRequestById(params: {
  id: number;
  role: UserRole;
  studentRosterId?: number | null;
}): Promise<LeaveRequestItem> {
  const row = await getLeaveRequestRawRowById(params);
  return mapLeaveRow(row);
}

/**
 * US-20 & BR-26 — PATCH /api/leave-requests/:id/cancel
 * Siswa membatalkan surat izin miliknya selama masih berstatus 'menunggu'.
 */
export async function cancelLeaveRequest(params: {
  id: number;
  studentRosterId: number;
}): Promise<LeaveRequestItem> {
  const row = await getLeaveRequestRawRowById({
    id: params.id,
    role: "siswa",
    studentRosterId: params.studentRosterId,
  });

  if (row.status !== "menunggu") {
    throw new AppError(
      "Surat izin yang sudah diproses atau dibatalkan tidak dapat dibatalkan lagi.",
      409,
      { code: "LEAVE_ALREADY_REVIEWED" }
    );
  }

  await database.execute(
    `UPDATE leave_requests
     SET status = 'dibatalkan'
     WHERE id = ? AND student_id = ?`,
    [params.id, params.studentRosterId]
  );

  return getLeaveRequestById({
    id: params.id,
    role: "siswa",
    studentRosterId: params.studentRosterId,
  });
}

/**
 * US-21, BR-23..25, BR-27 & BR-50e — PATCH /api/leave-requests/:id/review
 * Admin/Guru menyetujui atau menolak surat izin siswa.
 * Bila disetujui, otomatis mengisi attendance_records ('izin'/'sakit') pada hari sekolah
 * dalam rentang tanggal (dan mengoreksi record 'alpa' bila sudah telanjur tercatat, BR-27),
 * tanpa menimpa presensi 'hadir'/'terlambat' yang sudah sah (BR-25).
 */
export async function reviewLeaveRequest(params: {
  id: number;
  reviewerUserId: number;
  payload: unknown;
}): Promise<LeaveRequestItem> {
  if (
    typeof params.payload !== "object" ||
    params.payload === null ||
    Array.isArray(params.payload)
  ) {
    throw new AppError("Format keputusan review tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { _form: "Body request harus berupa objek JSON." },
    });
  }

  const body = params.payload as Record<string, unknown>;
  const rawDecision = String(
    body.decision ?? body.status ?? body.action ?? ""
  )
    .trim()
    .toLowerCase();

  let nextStatus: "disetujui" | "ditolak" | null = null;
  if (
    rawDecision === "approve" ||
    rawDecision === "approved" ||
    rawDecision === "disetujui" ||
    rawDecision === "setujui"
  ) {
    nextStatus = "disetujui";
  } else if (
    rawDecision === "reject" ||
    rawDecision === "rejected" ||
    rawDecision === "ditolak" ||
    rawDecision === "tolak"
  ) {
    nextStatus = "ditolak";
  }

  const rawNote = body.note ?? body.review_note ?? body.reviewNote ?? body.alasan;
  const note =
    typeof rawNote === "string" && rawNote.trim() !== ""
      ? rawNote.trim()
      : null;

  const errors: Record<string, string> = {};
  if (!nextStatus) {
    errors.decision =
      "Keputusan wajib diisi ('approve' / 'disetujui' atau 'reject' / 'ditolak').";
  }
  if (nextStatus === "ditolak" && !note) {
    errors.note = "Alasan penolakan wajib diisi saat menolak surat izin.";
  } else if (note && note.length > 500) {
    errors.note = "Catatan review maksimal 500 karakter.";
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi review surat izin gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  const row = await getLeaveRequestRawRowById({
    id: params.id,
    role: "admin",
  });

  // BR-25: Setelah diputuskan, tidak dapat diubah lagi (409 LEAVE_ALREADY_REVIEWED)
  if (row.status !== "menunggu") {
    throw new AppError(
      "Surat izin ini sudah diproses sebelumnya dan tidak dapat diubah.",
      409,
      { code: "LEAVE_ALREADY_REVIEWED" }
    );
  }

  await database.execute(
    `UPDATE leave_requests
     SET status = ?,
         reviewed_by = ?,
         reviewed_at = NOW(),
         review_note = ?
     WHERE id = ?`,
    [nextStatus, params.reviewerUserId, note, params.id]
  );

  // BR-23, BR-24, BR-25, BR-27: Jika disetujui, sinkronkan ke attendance_records
  if (nextStatus === "disetujui") {
    const targetAttendanceStatus: "sakit" | "izin" =
      row.category === "sakit" ? "sakit" : "izin";
    const startDate = formatDateYmd(row.start_date);
    const endDate = formatDateYmd(row.end_date);
    const datesInRange = enumerateDatesBetween(startDate, endDate);

    for (const dateYmd of datesInRange) {
      // BR-23: Hari yang bukan hari sekolah diabaikan
      const schoolDay = await isSchoolDayForLeave(dateYmd);
      if (!schoolDay) {
        continue;
      }

      const [existingRecs] = await database.execute<RowDataPacket[]>(
        `SELECT id, status, source
         FROM attendance_records
         WHERE student_id = ? AND attendance_date = ?
         LIMIT 1`,
        [row.student_id, dateYmd]
      );

      if (existingRecs.length === 0) {
        await database.execute(
          `INSERT INTO attendance_records
             (student_id, attendance_date, status, source, leave_request_id)
           VALUES (?, ?, ?, 'leave', ?)`,
          [row.student_id, dateYmd, targetAttendanceStatus, params.id]
        );
      } else {
        const existingRec = existingRecs[0];
        // BR-25 & BR-27: Jangan timpa 'hadir'/'terlambat', tetapi koreksi 'alpa' menjadi 'izin'/'sakit'
        if (
          existingRec.status === "alpa" ||
          existingRec.source === "leave"
        ) {
          await database.execute(
            `UPDATE attendance_records
             SET status = ?,
                 source = 'leave',
                 leave_request_id = ?
             WHERE id = ?`,
            [targetAttendanceStatus, params.id, existingRec.id]
          );
        }
      }
    }
  }

  const updated = await getLeaveRequestById({
    id: params.id,
    role: "admin",
  });

  // BR-50e: Kirim notifikasi ke akun siswa bila siswa sudah memiliki user_id
  if (updated.student.user_id) {
    await NotificationService.notifyLeaveReviewed({
      studentUserId: updated.student.user_id,
      leaveRequestId: updated.id,
      status: nextStatus!,
      startDate: updated.start_date,
      endDate: updated.end_date,
      reviewNote: updated.review_note,
    });
  }

  return updated;
}
