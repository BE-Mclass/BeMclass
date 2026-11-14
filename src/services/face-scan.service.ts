import path from "path";
import { RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { FaceResultCode, getFaceMatchThreshold } from "../integrations/ai.client";
import { AppError } from "../utils/errors";
import { createSignedFileUrl } from "../utils/signed-url";
import { nowUtc, toWibDate } from "../utils/wib-time";
import {
  AttemptOutcome,
  ensureAttendanceAttemptsTable,
} from "./attendance.service";
import { recordAuditLog } from "./audit.service";
import { ensureFaceSchema } from "./face.service";
import { ensureProfileColumns } from "./profile.service";
import { getSchoolConfig } from "./school.service";

export const VALID_FACE_RESULTS: readonly FaceResultCode[] = [
  "match",
  "no_match",
  "no_face",
  "multiple_faces",
  "low_quality",
  "error",
] as const;

export const FACE_RESULT_LABELS: Record<FaceResultCode, string> = {
  match: "Cocok",
  no_match: "Tidak cocok",
  no_face: "Wajah tidak terdeteksi",
  multiple_faces: "Lebih dari satu wajah",
  low_quality: "Foto kurang jelas",
  error: "Gagal diproses",
};

const VALID_ATTEMPT_OUTCOMES: readonly AttemptOutcome[] = [
  "recorded",
  "rejected_outside_radius",
  "rejected_face",
  "rejected_time_window",
  "rejected_mock_location",
  "rejected_gps_accuracy",
  "rejected_already_recorded",
  "rejected_not_enrolled",
  "error",
] as const;

function getAttemptPhotoRetentionDays(): number {
  const raw = Number(process.env.ATTEMPT_PHOTO_RETENTION_DAYS ?? 90);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 90;
}

function toIsoStringOrNull(val: Date | string | null | undefined): string | null {
  if (!val) {
    return null;
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString();
  }
  if (typeof val === "string") {
    const normalized = val.includes("T") ? val : `${val.replace(" ", "T")}+07:00`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    const fallback = new Date(val);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback.toISOString();
    }
    return val;
  }
  return null;
}

function formatDateOnly(val: Date | string | null | undefined): string | null {
  if (!val) {
    return null;
  }
  if (typeof val === "string") {
    return val.slice(0, 10);
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface FaceScanRow extends RowDataPacket {
  scan_id: number;
  student_id: number;
  attempted_at: Date | string;
  client_captured_at: Date | string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  accuracy_m: number | string | null;
  distance_m: number | string | null;
  within_radius: number | null;
  is_mocked: number;
  photo_path: string | null;
  face_similarity: number | string | null;
  face_result: FaceResultCode | null;
  outcome: AttemptOutcome;
  record_id: number | null;
  device: string | null;
  model_version: string | null;
  nisn: string;
  student_name: string;
  gender?: "L" | "P" | null;
  birth_date?: Date | string | null;
  guardian_name?: string | null;
  attendance_number: number | null;
  class_id: number | null;
  class_name: string | null;
}

interface AttendanceRecordBriefRow extends RowDataPacket {
  id: number;
  status: string;
  check_in_at: Date | string | null;
}

interface FaceTemplatePhotoRow extends RowDataPacket {
  photo_path: string | null;
}

export interface ListFaceScansQuery {
  class_id?: unknown;
  date?: unknown;
  nisn?: unknown;
  result?: unknown;
  outcome?: unknown;
  q?: unknown;
  all?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface FaceScanListItem {
  scan_id: number;
  nisn: string;
  name: string;
  class: {
    id: number;
    name: string;
  } | null;
  attempted_at: string;
  result: FaceResultCode | null;
  result_label: string | null;
  similarity: number | null;
  outcome: AttemptOutcome;
  distance_m: number | null;
  within_radius: boolean | null;
  record_id: number | null;
}

/**
 * US-42, BR-19 & FSD §5.7 — GET /api/face-scans
 * Menampilkan daftar percobaan scan wajah siswa (read-only untuk admin & guru).
 * Default `date` = hari ini (WIB), urut `attempted_at` DESC.
 */
export async function listFaceScans(query: ListFaceScansQuery) {
  await Promise.all([
    ensureAttendanceAttemptsTable(),
    ensureFaceSchema(),
    ensureProfileColumns(),
  ]);

  const errors: Record<string, string> = {};

  // 1. Filter date (default: hari ini WIB; kecuali date="all" atau all="true")
  const rawDate =
    query.date !== undefined && query.date !== null
      ? String(query.date).trim()
      : "";
  const isAllDates =
    rawDate.toLowerCase() === "all" ||
    String(query.all ?? "").toLowerCase() === "true" ||
    String(query.all ?? "") === "1";

  let filterDate: string | null = null;
  if (!isAllDates) {
    if (rawDate === "") {
      filterDate = toWibDate(nowUtc());
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      errors.date = "Format tanggal (date) harus YYYY-MM-DD.";
    } else {
      filterDate = rawDate;
    }
  }

  // 2. Filter class_id
  let filterClassId: number | null = null;
  if (
    query.class_id !== undefined &&
    query.class_id !== null &&
    String(query.class_id).trim() !== ""
  ) {
    const parsedClassId = Number(String(query.class_id).trim());
    if (!Number.isSafeInteger(parsedClassId) || parsedClassId <= 0) {
      errors.class_id = "Filter class_id harus berupa bilangan bulat positif.";
    } else {
      filterClassId = parsedClassId;
    }
  }

  // 3. Filter nisn
  let filterNisn: string | null = null;
  if (
    query.nisn !== undefined &&
    query.nisn !== null &&
    String(query.nisn).trim() !== ""
  ) {
    const trimmedNisn = String(query.nisn).trim();
    if (!/^\d{1,10}$/.test(trimmedNisn)) {
      errors.nisn = "Filter NISN hanya boleh berisi angka (maksimal 10 digit).";
    } else {
      filterNisn = trimmedNisn;
    }
  }

  // 4. Filter result (match | no_match | no_face | multiple_faces | low_quality | error)
  let filterResult: FaceResultCode | null = null;
  if (
    query.result !== undefined &&
    query.result !== null &&
    String(query.result).trim() !== ""
  ) {
    const rawResult = String(query.result).trim().toLowerCase();
    if (!VALID_FACE_RESULTS.includes(rawResult as FaceResultCode)) {
      errors.result = `Filter result tidak valid. Gunakan salah satu: ${VALID_FACE_RESULTS.join(", ")}.`;
    } else {
      filterResult = rawResult as FaceResultCode;
    }
  }

  // 5. Filter outcome (opsional)
  let filterOutcome: AttemptOutcome | null = null;
  if (
    query.outcome !== undefined &&
    query.outcome !== null &&
    String(query.outcome).trim() !== ""
  ) {
    const rawOutcome = String(query.outcome).trim().toLowerCase();
    if (!VALID_ATTEMPT_OUTCOMES.includes(rawOutcome as AttemptOutcome)) {
      errors.outcome = `Filter outcome tidak valid. Gunakan salah satu: ${VALID_ATTEMPT_OUTCOMES.join(", ")}.`;
    } else {
      filterOutcome = rawOutcome as AttemptOutcome;
    }
  }

  // 6. Pagination (page default 1, limit default 20, max 100)
  let page = 1;
  if (
    query.page !== undefined &&
    query.page !== null &&
    String(query.page).trim() !== ""
  ) {
    const parsedPage = Number(String(query.page).trim());
    if (!Number.isSafeInteger(parsedPage) || parsedPage < 1) {
      errors.page = "Parameter page harus berupa bilangan bulat >= 1.";
    } else {
      page = parsedPage;
    }
  }

  let limit = 20;
  if (
    query.limit !== undefined &&
    query.limit !== null &&
    String(query.limit).trim() !== ""
  ) {
    const parsedLimit = Number(String(query.limit).trim());
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      errors.limit = "Parameter limit harus berupa bilangan bulat antara 1 s.d. 100.";
    } else {
      limit = parsedLimit;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Parameter filter hasil scan wajah tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  const whereClauses: string[] = [];
  const params: Array<string | number | null> = [];

  if (filterDate) {
    whereClauses.push("DATE(aa.attempted_at) = ?");
    params.push(filterDate);
  }
  if (filterClassId !== null) {
    whereClauses.push("sr.class_id = ?");
    params.push(filterClassId);
  }
  if (filterNisn !== null) {
    if (filterNisn.length === 10) {
      whereClauses.push("sr.nisn = ?");
      params.push(filterNisn);
    } else {
      whereClauses.push("sr.nisn LIKE ?");
      params.push(`%${filterNisn}%`);
    }
  }
  if (filterResult !== null) {
    whereClauses.push("aa.face_result = ?");
    params.push(filterResult);
  }
  if (filterOutcome !== null) {
    whereClauses.push("aa.outcome = ?");
    params.push(filterOutcome);
  }

  const rawQ =
    query.q !== undefined && query.q !== null ? String(query.q).trim() : "";
  if (rawQ !== "") {
    whereClauses.push("(sr.full_name LIKE ? OR sr.nisn LIKE ?)");
    params.push(`%${rawQ}%`, `%${rawQ}%`);
  }

  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const [countRows] = await database.execute<CountRow[]>(
    `SELECT COUNT(*) AS total
     FROM attendance_attempts aa
     INNER JOIN student_roster sr ON sr.id = aa.student_id
     LEFT JOIN classes c ON c.id = sr.class_id
     ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total ?? 0);
  const offset = (page - 1) * limit;

  const [rows] = await database.execute<FaceScanRow[]>(
    `SELECT
       aa.id AS scan_id,
       aa.student_id,
       aa.attempted_at,
       aa.face_result,
       aa.face_similarity,
       aa.outcome,
       aa.distance_m,
       aa.within_radius,
       aa.record_id,
       sr.nisn,
       sr.full_name AS student_name,
       sr.class_id,
       c.name AS class_name
     FROM attendance_attempts aa
     INNER JOIN student_roster sr ON sr.id = aa.student_id
     LEFT JOIN classes c ON c.id = sr.class_id
     ${whereSql}
     ORDER BY aa.attempted_at DESC, aa.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const items: FaceScanListItem[] = rows.map((row) => {
    const faceResult = (row.face_result as FaceResultCode | null) ?? null;
    return {
      scan_id: Number(row.scan_id),
      nisn: String(row.nisn),
      name: String(row.student_name),
      class:
        row.class_id !== null && row.class_id !== undefined
          ? {
              id: Number(row.class_id),
              name: String(row.class_name ?? `Kelas ${row.class_id}`),
            }
          : null,
      attempted_at:
        toIsoStringOrNull(row.attempted_at) ?? new Date().toISOString(),
      result: faceResult,
      result_label: faceResult ? (FACE_RESULT_LABELS[faceResult] ?? null) : null,
      similarity:
        row.face_similarity !== null && row.face_similarity !== undefined
          ? Number(row.face_similarity)
          : null,
      outcome: row.outcome,
      distance_m:
        row.distance_m !== null && row.distance_m !== undefined
          ? Number(row.distance_m)
          : null,
      within_radius:
        row.within_radius === null || row.within_radius === undefined
          ? null
          : Boolean(Number(row.within_radius)),
      record_id:
        row.record_id !== null && row.record_id !== undefined
          ? Number(row.record_id)
          : null,
    };
  });

  return {
    items,
    meta: {
      page,
      limit,
      total,
      total_pages: total > 0 ? Math.ceil(total / limit) : 0,
      date: filterDate,
    },
  };
}

/**
 * US-42, BR-19, BR-71 & FSD §5.7 — GET /api/face-scans/:scanId
 * Mengambil detail satu percobaan scan wajah (foto scan vs foto referensi, skor kemiripan,
 * jarak vs radius, serta record presensi terkait) dan mencatat akses ke `audit_logs` (`face_scan.view`).
 */
export async function getFaceScanDetail(params: {
  scanId: number;
  actorUserId: number;
  ip?: string | null;
}) {
  if (!Number.isSafeInteger(params.scanId) || params.scanId <= 0) {
    throw new AppError("ID hasil scan wajah tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { scanId: "scanId harus berupa bilangan bulat positif." },
    });
  }

  await Promise.all([
    ensureAttendanceAttemptsTable(),
    ensureFaceSchema(),
    ensureProfileColumns(),
  ]);

  const [rows] = await database.execute<FaceScanRow[]>(
    `SELECT
       aa.id AS scan_id,
       aa.student_id,
       aa.attempted_at,
       aa.client_captured_at,
       aa.latitude,
       aa.longitude,
       aa.accuracy_m,
       aa.distance_m,
       aa.within_radius,
       aa.is_mocked,
       aa.photo_path,
       aa.face_similarity,
       aa.face_result,
       aa.outcome,
       aa.record_id,
       aa.device,
       aa.model_version,
       sr.nisn,
       sr.full_name AS student_name,
       sr.gender,
       sr.birth_date,
       sr.guardian_name,
       sr.attendance_number,
       sr.class_id,
       c.name AS class_name
     FROM attendance_attempts aa
     INNER JOIN student_roster sr ON sr.id = aa.student_id
     LEFT JOIN classes c ON c.id = sr.class_id
     WHERE aa.id = ?
     LIMIT 1`,
    [params.scanId]
  );

  if (rows.length === 0) {
    throw new AppError("Data hasil scan wajah tidak ditemukan.", 404, {
      code: "NOT_FOUND",
    });
  }

  const row = rows[0];
  const studentRosterId = Number(row.student_id);

  // Ambil konfigurasi radius sekolah, foto referensi wajah siswa, dan record presensi terkait secara paralel
  const [schoolConfig, templateRows, recordRows] = await Promise.all([
    getSchoolConfig(),
    database
      .execute<FaceTemplatePhotoRow[]>(
        `SELECT photo_path
         FROM face_templates
         WHERE student_id = ? AND status = 'active' AND photo_path IS NOT NULL
         ORDER BY id DESC
         LIMIT 1`,
        [studentRosterId]
      )
      .then(([res]) => res)
      .catch(() => [] as FaceTemplatePhotoRow[]),
    row.record_id !== null && row.record_id !== undefined
      ? database
          .execute<AttendanceRecordBriefRow[]>(
            `SELECT id, status, check_in_at
             FROM attendance_records
             WHERE id = ?
             LIMIT 1`,
            [Number(row.record_id)]
          )
          .then(([res]) => res)
      : Promise.resolve([] as AttendanceRecordBriefRow[]),
  ]);

  // Signed URL untuk foto referensi enrollment wajah
  const refPhotoPath = templateRows[0]?.photo_path ?? null;
  let referencePhotoUrl: string | null = null;
  if (refPhotoPath) {
    try {
      referencePhotoUrl = createSignedFileUrl({
        category: "faces",
        filename: path.basename(refPhotoPath),
      });
    } catch {
      referencePhotoUrl = null;
    }
  }

  // Signed URL untuk foto hasil scan presensi & pengecekan masa retensi (BR-71)
  const retentionDays = getAttemptPhotoRetentionDays();
  const attemptedIso =
    toIsoStringOrNull(row.attempted_at) ?? new Date().toISOString();
  const attemptedMs = new Date(attemptedIso).getTime();
  const nowMs = nowUtc().getTime();
  const ageDays = Number.isFinite(attemptedMs)
    ? (nowMs - attemptedMs) / (1000 * 60 * 60 * 24)
    : 0;
  const isRetentionExpired = ageDays > retentionDays;

  let capturedPhotoUrl: string | null = null;
  let photoExpired = false;

  if (!row.photo_path || isRetentionExpired) {
    capturedPhotoUrl = null;
    photoExpired = true;
  } else {
    try {
      capturedPhotoUrl = createSignedFileUrl({
        category: "attendance",
        filename: path.basename(row.photo_path),
      });
      photoExpired = false;
    } catch {
      capturedPhotoUrl = null;
      photoExpired = true;
    }
  }

  const recordRow = recordRows[0] ?? null;
  const recordData = recordRow
    ? {
        id: Number(recordRow.id),
        status: String(recordRow.status),
        check_in_at: toIsoStringOrNull(recordRow.check_in_at),
      }
    : null;

  const faceResult = (row.face_result as FaceResultCode | null) ?? null;

  // BR-19 & FSD §5.7 / §7: Catat akses detail scan wajah ke audit_logs
  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: "face_scan.view",
    entity: "attendance_attempts",
    entityId: Number(row.scan_id),
    meta: {
      scan_id: Number(row.scan_id),
      student_id: studentRosterId,
      nisn: String(row.nisn),
      result: faceResult,
      outcome: row.outcome,
      record_id: recordData?.id ?? null,
    },
    ip: params.ip ?? null,
  });

  return {
    scan_id: Number(row.scan_id),
    attempted_at: attemptedIso,
    result: faceResult,
    result_label: faceResult ? (FACE_RESULT_LABELS[faceResult] ?? null) : null,
    similarity:
      row.face_similarity !== null && row.face_similarity !== undefined
        ? Number(row.face_similarity)
        : null,
    match_threshold: getFaceMatchThreshold(),
    outcome: row.outcome,
    student: {
      nisn: String(row.nisn),
      name: String(row.student_name),
      class:
        row.class_id !== null && row.class_id !== undefined
          ? {
              id: Number(row.class_id),
              name: String(row.class_name ?? `Kelas ${row.class_id}`),
            }
          : null,
      gender: (row.gender as "L" | "P" | null) ?? "L",
      birth_date: formatDateOnly(row.birth_date),
      guardian_name: row.guardian_name ? String(row.guardian_name) : null,
      absence_number:
        row.attendance_number !== null && row.attendance_number !== undefined
          ? Number(row.attendance_number)
          : null,
    },
    reference_photo_url: referencePhotoUrl,
    captured_photo_url: capturedPhotoUrl,
    photo_expired: photoExpired,
    location: {
      latitude:
        row.latitude !== null && row.latitude !== undefined
          ? Number(row.latitude)
          : null,
      longitude:
        row.longitude !== null && row.longitude !== undefined
          ? Number(row.longitude)
          : null,
      accuracy_m:
        row.accuracy_m !== null && row.accuracy_m !== undefined
          ? Number(row.accuracy_m)
          : null,
      distance_m:
        row.distance_m !== null && row.distance_m !== undefined
          ? Number(row.distance_m)
          : null,
      radius_m: schoolConfig.geofence.radius_m,
      within_radius:
        row.within_radius === null || row.within_radius === undefined
          ? null
          : Boolean(Number(row.within_radius)),
      is_mocked: Boolean(Number(row.is_mocked)),
    },
    record: recordData,
  };
}
