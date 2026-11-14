import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { FaceResultCode, verifyFaceWithAi } from "../integrations/ai.client";
import { saveAttendanceAttemptPhoto } from "../utils/attendance-upload";
import { AppError } from "../utils/errors";
import { ValidatedFacePhoto } from "../utils/face-upload";
import { evaluateGeofence, isValidCoordinates } from "../utils/geo";
import { getDayOfWeekIso, nowUtc, toWibDate, wibTimeOfDay } from "../utils/wib-time";
import { getActiveStudentFaceEmbeddings } from "./face.service";
import { NotificationService } from "./notification.service";
import { getHolidayAnnouncementOnDate, getSchoolConfig } from "./school.service";

export const LATE_REASON_OPTIONS = [
  "macet",
  "kendala_kendaraan",
  "keperluan_keluarga",
  "lainnya",
] as const;

export type LateReasonOption = (typeof LATE_REASON_OPTIONS)[number];

export type AttemptOutcome =
  | "recorded"
  | "rejected_outside_radius"
  | "rejected_face"
  | "rejected_time_window"
  | "rejected_mock_location"
  | "rejected_gps_accuracy"
  | "rejected_already_recorded"
  | "rejected_not_enrolled"
  | "error";

const DEFAULT_ATTEMPT_MAX_PER_DAY = Number(
  process.env.ATTEMPT_MAX_PER_DAY ?? 10
);
const DEFAULT_GPS_MAX_ACCURACY_M = Number(
  process.env.GPS_MAX_ACCURACY_M ?? 30
);

interface CountRow extends RowDataPacket {
  total: number;
}

interface AttendanceRecordRow extends RowDataPacket {
  id: number;
  student_id: number;
  attendance_date: string | Date;
  status: "hadir" | "terlambat" | "izin" | "sakit" | "alpa";
  source: "face_gps" | "leave" | "auto_alpa" | "manual";
  check_in_at: Date | string | null;
  late_minutes: number | null;
  late_reason: LateReasonOption | null;
  late_note: string | null;
  attempt_id: number | null;
  leave_request_id: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

let attendanceSchemaChecked = false;

export async function ensureAttendanceAttemptsTable(): Promise<void> {
  if (attendanceSchemaChecked) {
    return;
  }
  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS attendance_attempts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_id BIGINT UNSIGNED NOT NULL COMMENT 'References student_roster(id)',
        attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Waktu server otoritatif',
        client_captured_at DATETIME NULL,
        latitude DECIMAL(9, 6) NULL,
        longitude DECIMAL(9, 6) NULL,
        accuracy_m DECIMAL(7, 2) NULL,
        distance_m DECIMAL(8, 2) NULL,
        within_radius TINYINT(1) NULL,
        is_mocked TINYINT(1) NOT NULL DEFAULT 0,
        photo_path VARCHAR(255) NULL,
        face_similarity DECIMAL(6, 5) NULL,
        face_result ENUM('match', 'no_match', 'no_face', 'multiple_faces', 'low_quality', 'error') NULL,
        outcome ENUM(
          'recorded',
          'rejected_outside_radius',
          'rejected_face',
          'rejected_time_window',
          'rejected_mock_location',
          'rejected_gps_accuracy',
          'rejected_already_recorded',
          'rejected_not_enrolled',
          'error'
        ) NOT NULL,
        record_id BIGINT UNSIGNED NULL,
        device VARCHAR(100) NULL,
        model_version VARCHAR(30) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_att_student_time (student_id, attempted_at),
        INDEX idx_att_outcome_time (outcome, attempted_at),
        CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES student_roster(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    attendanceSchemaChecked = true;
  } catch {
    attendanceSchemaChecked = true;
  }
}

export function resetAttendanceSchemaCheckForTesting(): void {
  attendanceSchemaChecked = true;
}

function toMysqlDateTime(date: Date): string {
  return `${toWibDate(date)} ${wibTimeOfDay(date)}`;
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

function formatDateYmd(val: Date | string): string {
  if (typeof val === "string") {
    return val.slice(0, 10);
  }
  const y = val.getFullYear();
  const m = String(val.getMonth() + 1).padStart(2, "0");
  const d = String(val.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(":").map(Number);
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  return hh * 3600 + mm * 60 + ss;
}

function parseFiniteNumber(raw: unknown): number {
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return Number(raw.trim());
  }
  return Number.NaN;
}

function parseBooleanInput(raw: unknown): boolean | null {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (raw === 1 || raw === "1") {
    return true;
  }
  if (raw === 0 || raw === "0") {
    return false;
  }
  if (typeof raw === "string") {
    const lower = raw.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null;
}

async function insertAttemptRow(params: {
  studentId: number;
  attemptedAt: Date;
  clientCapturedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  distanceM: number | null;
  withinRadius: boolean | null;
  isMocked: boolean;
  photoPath: string | null;
  faceSimilarity: number | null;
  faceResult: FaceResultCode | null;
  outcome: AttemptOutcome;
  recordId?: number | null;
  device: string | null;
  modelVersion: string | null;
}): Promise<number> {
  const [res] = await database.execute<ResultSetHeader>(
    `INSERT INTO attendance_attempts
       (student_id, attempted_at, client_captured_at, latitude, longitude, accuracy_m,
        distance_m, within_radius, is_mocked, photo_path, face_similarity, face_result,
        outcome, record_id, device, model_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.studentId,
      toMysqlDateTime(params.attemptedAt),
      params.clientCapturedAt ? toMysqlDateTime(params.clientCapturedAt) : null,
      params.latitude,
      params.longitude,
      params.accuracyM,
      params.distanceM,
      params.withinRadius === null ? null : params.withinRadius ? 1 : 0,
      params.isMocked ? 1 : 0,
      params.photoPath,
      params.faceSimilarity,
      params.faceResult,
      params.outcome,
      params.recordId ?? null,
      params.device,
      params.modelVersion,
    ]
  );
  return Number(res.insertId);
}

/**
 * US-11, BR-10..17, BR-50a, BR-50b & FSD §5.4 — POST /api/attendance/check-in
 * Memproses presensi masuk siswa berbasis GPS Haversine + Verifikasi Wajah Otomatis.
 * Seluruh outcome (berhasil maupun ditolak) dicatat di `attendance_attempts`.
 */
export async function checkInStudentAttendance(params: {
  studentRosterId: number;
  studentUserId: number;
  fields: Record<string, unknown>;
  photo: ValidatedFacePhoto;
  allowDevFallback?: boolean;
  serverNowOverride?: Date;
}) {
  await ensureAttendanceAttemptsTable();

  const { studentRosterId, studentUserId, fields, photo } = params;
  const serverNow = params.serverNowOverride ?? nowUtc();
  const todayWib = toWibDate(serverNow);
  const currentWibTimeHms = wibTimeOfDay(serverNow);

  // 1. Validasi field request
  const errors: Record<string, string> = {};
  const latitude = parseFiniteNumber(fields.latitude ?? fields.lat);
  const longitude = parseFiniteNumber(fields.longitude ?? fields.lng ?? fields.lon);
  const accuracyM = parseFiniteNumber(
    fields.accuracy_m ?? fields.accuracyM ?? fields.accuracy
  );
  const isMocked = parseBooleanInput(
    fields.is_mocked ?? fields.isMocked ?? false
  );

  if (!isValidCoordinates(latitude, longitude)) {
    errors.coordinates =
      "Koordinat latitude (-90..90) dan longitude (-180..180) wajib diisi dengan angka yang valid.";
  }

  if (!Number.isFinite(accuracyM) || accuracyM < 0) {
    errors.accuracy_m =
      "Akurasi GPS (accuracy_m) wajib berupa angka positif (dalam meter).";
  }

  if (isMocked === null) {
    errors.is_mocked = "Status is_mocked harus berupa boolean (true/false).";
  }

  const rawCapturedAt = fields.captured_at ?? fields.capturedAt;
  let clientCapturedAt: Date | null = null;
  if (rawCapturedAt !== undefined && rawCapturedAt !== null && rawCapturedAt !== "") {
    const parsedDate = new Date(String(rawCapturedAt));
    if (Number.isNaN(parsedDate.getTime())) {
      errors.captured_at =
        "Format waktu captured_at tidak valid (gunakan ISO-8601).";
    } else {
      clientCapturedAt = parsedDate;
    }
  } else {
    clientCapturedAt = serverNow;
  }

  const rawDevice = fields.device ?? fields.device_info;
  const device =
    typeof rawDevice === "string" && rawDevice.trim() !== ""
      ? rawDevice.trim().slice(0, 100)
      : null;

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi input presensi gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  // 2. BR-17: Cek batas maksimal percobaan per hari (ATTEMPT_MAX_PER_DAY = 10)
  const [attemptCountRows] = await database.execute<CountRow[]>(
    `SELECT COUNT(*) AS total
     FROM attendance_attempts
     WHERE student_id = ? AND DATE(attempted_at) = ?`,
    [studentRosterId, todayWib]
  );
  const attemptsToday = Number(attemptCountRows[0]?.total ?? 0);
  if (attemptsToday >= DEFAULT_ATTEMPT_MAX_PER_DAY) {
    throw new AppError(
      `Anda telah mencapai batas maksimal percobaan presensi hari ini (${DEFAULT_ATTEMPT_MAX_PER_DAY} kali).`,
      429,
      { code: "TOO_MANY_ATTEMPTS" }
    );
  }

  // Simpan foto attempt ke disk (uploads/attendance/<uuid>.<ext>)
  const savedPhoto = saveAttendanceAttemptPhoto(photo.buffer, photo.ext);

  // Ambil konfigurasi geofence & jadwal hari ini
  const schoolConfig = await getSchoolConfig();
  const geofenceEval = evaluateGeofence(
    { latitude, longitude },
    {
      latitude: schoolConfig.geofence.latitude,
      longitude: schoolConfig.geofence.longitude,
    },
    schoolConfig.geofence.radius_m
  );

  const baseAttemptData = {
    studentId: studentRosterId,
    attemptedAt: serverNow,
    clientCapturedAt,
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracyM: Number(accuracyM.toFixed(2)),
    distanceM: geofenceEval.distance_m,
    withinRadius: geofenceEval.within_radius,
    isMocked: Boolean(isMocked),
    photoPath: savedPhoto.relativePath,
    faceSimilarity: null as number | null,
    faceResult: null as FaceResultCode | null,
    device,
    modelVersion: null as string | null,
  };

  // 3. BR-16: Cek duplikat presensi atau izin disetujui hari ini
  const [existingRecords] = await database.execute<AttendanceRecordRow[]>(
    `SELECT id, status, source
     FROM attendance_records
     WHERE student_id = ? AND attendance_date = ?
     LIMIT 1`,
    [studentRosterId, todayWib]
  );

  if (existingRecords.length > 0) {
    const existing = existingRecords[0];
    if (existing.status === "hadir" || existing.status === "terlambat") {
      await insertAttemptRow({
        ...baseAttemptData,
        outcome: "rejected_already_recorded",
        recordId: Number(existing.id),
      });
      throw new AppError("Anda sudah melakukan presensi masuk hari ini.", 409, {
        code: "ALREADY_CHECKED_IN",
      });
    }

    if (existing.status === "izin" || existing.status === "sakit") {
      await insertAttemptRow({
        ...baseAttemptData,
        outcome: "rejected_already_recorded",
        recordId: Number(existing.id),
      });
      throw new AppError(
        "Anda memiliki surat izin/sakit yang telah disetujui untuk hari ini.",
        409,
        { code: "HAS_APPROVED_LEAVE" }
      );
    }
  }

  // 4. BR-10 & BR-11: Cek hari sekolah aktif & jendela jam presensi (WIB)
  const targetDayOfWeek = getDayOfWeekIso(todayWib);
  const targetSchedule =
    schoolConfig.schedules.find((s) => s.day_of_week === targetDayOfWeek) ??
    schoolConfig.today;
  const holidayOnTargetDate = params.serverNowOverride
    ? await getHolidayAnnouncementOnDate(todayWib)
    : schoolConfig.today.holiday_title
      ? { id: 0, title: schoolConfig.today.holiday_title }
      : null;
  const isTargetSchoolDay =
    Boolean(targetSchedule?.is_school_day) && !holidayOnTargetDate;

  if (!isTargetSchoolDay) {
    await insertAttemptRow({
      ...baseAttemptData,
      outcome: "rejected_time_window",
    });
    const holidayNote = holidayOnTargetDate?.title
      ? ` (${holidayOnTargetDate.title})`
      : "";
    throw new AppError(
      `Hari ini bukan hari sekolah aktif atau sedang hari libur${holidayNote}.`,
      422,
      { code: "NOT_SCHOOL_DAY" }
    );
  }

  const checkinOpenHm = targetSchedule.checkin_open ?? "06:00";
  const lateAfterHm = targetSchedule.late_after ?? "07:15";
  const checkinCloseHm = targetSchedule.checkin_close ?? "12:00";

  const nowSeconds = timeStringToSeconds(currentWibTimeHms);
  const openSeconds = timeStringToSeconds(`${checkinOpenHm}:00`);
  const lateAfterSeconds = timeStringToSeconds(`${lateAfterHm}:00`);
  const closeSeconds = timeStringToSeconds(`${checkinCloseHm}:59`);

  if (nowSeconds < openSeconds || nowSeconds > closeSeconds) {
    await insertAttemptRow({
      ...baseAttemptData,
      outcome: "rejected_time_window",
    });
    throw new AppError(
      `Presensi masuk hanya dibuka pada pukul ${checkinOpenHm} s.d. ${checkinCloseHm} WIB.`,
      422,
      {
        code: "OUTSIDE_TIME_WINDOW",
        details: {
          checkin_open: checkinOpenHm,
          checkin_close: checkinCloseHm,
          server_time_wib: currentWibTimeHms,
        },
      }
    );
  }

  // 5. BR-13: Cek kualitas GPS & Mock Location
  if (isMocked) {
    await insertAttemptRow({
      ...baseAttemptData,
      outcome: "rejected_mock_location",
    });
    throw new AppError(
      "Lokasi palsu (Fake GPS / Mock Location) terdeteksi. Matikan aplikasi lokasi palsu dan coba lagi.",
      422,
      { code: "MOCK_LOCATION" }
    );
  }

  if (accuracyM > DEFAULT_GPS_MAX_ACCURACY_M) {
    await insertAttemptRow({
      ...baseAttemptData,
      outcome: "rejected_gps_accuracy",
    });
    throw new AppError(
      `Akurasi sinyal GPS terlalu rendah (${Math.round(accuracyM)}m > batas ${DEFAULT_GPS_MAX_ACCURACY_M}m). Aktifkan mode GPS Akurasi Tinggi di area terbuka.`,
      422,
      {
        code: "GPS_ACCURACY_LOW",
        details: {
          accuracy_m: Number(accuracyM.toFixed(2)),
          max_accuracy_m: DEFAULT_GPS_MAX_ACCURACY_M,
        },
      }
    );
  }

  // 6. BR-12: Cek jarak Haversine terhadap radius sekolah (radius_m = 15m)
  if (!geofenceEval.within_radius) {
    const attemptId = await insertAttemptRow({
      ...baseAttemptData,
      outcome: "rejected_outside_radius",
    });

    // BR-50b: Kirim notifikasi percobaan di luar radius ke siswa
    await NotificationService.notifyOutsideRadiusAttempt({
      studentUserId,
      attemptId,
      distanceM: geofenceEval.distance_m,
      radiusM: geofenceEval.radius_m,
    });

    throw new AppError(
      `Lokasi Anda berada di luar radius sekolah (${geofenceEval.distance_m}m dari batas maksimal ${geofenceEval.radius_m}m).`,
      422,
      {
        code: "OUTSIDE_RADIUS",
        details: {
          distance_m: geofenceEval.distance_m,
          radius_m: geofenceEval.radius_m,
        },
      }
    );
  }

  // 7. BR-14: Pastikan siswa sudah memiliki template wajah aktif & verifikasi ke Flask AI
  const activeTemplates = await getActiveStudentFaceEmbeddings(studentRosterId);
  if (activeTemplates.embeddings.length === 0) {
    await insertAttemptRow({
      ...baseAttemptData,
      outcome: "rejected_not_enrolled",
    });
    throw new AppError(
      "Wajah Anda belum terdaftar. Silakan lakukan pendaftaran wajah terlebih dahulu.",
      409,
      { code: "FACE_NOT_ENROLLED" }
    );
  }

  const aiResult = await verifyFaceWithAi({
    imageBuffer: photo.buffer,
    mimeType: photo.mime,
    references: activeTemplates.embeddings,
    allowDevFallback: params.allowDevFallback,
  });

  if (aiResult.faceResult === "error") {
    await insertAttemptRow({
      ...baseAttemptData,
      faceResult: "error",
      outcome: "error",
      modelVersion: aiResult.modelVersion ?? activeTemplates.modelVersion,
    });
    throw new AppError(
      "Layanan verifikasi wajah (AI) sedang tidak tersedia. Silakan coba beberapa saat lagi.",
      503,
      { code: "AI_UNAVAILABLE" }
    );
  }

  if (aiResult.faceResult !== "match") {
    await insertAttemptRow({
      ...baseAttemptData,
      faceSimilarity: aiResult.similarityMax,
      faceResult: aiResult.faceResult,
      outcome: "rejected_face",
      modelVersion: aiResult.modelVersion ?? activeTemplates.modelVersion,
    });

    if (aiResult.faceResult === "no_face") {
      throw new AppError(
        "Wajah tidak terdeteksi pada foto. Pastikan wajah terlihat jelas di kamera.",
        422,
        { code: "NO_FACE" }
      );
    }
    if (aiResult.faceResult === "multiple_faces") {
      throw new AppError(
        "Terdeteksi lebih dari satu wajah pada foto. Pastikan hanya wajah Anda di dalam frame.",
        422,
        { code: "MULTIPLE_FACES" }
      );
    }
    if (aiResult.faceResult === "low_quality") {
      throw new AppError(
        "Kualitas foto wajah kurang jelas (buram atau terlalu gelap). Silakan ambil ulang foto.",
        422,
        { code: "LOW_QUALITY" }
      );
    }

    throw new AppError(
      "Wajah tidak cocok dengan data referensi siswa. Silakan coba lagi dengan pencahayaan yang baik.",
      422,
      {
        code: "FACE_MISMATCH",
        details: {
          similarity: aiResult.similarityMax,
        },
      }
    );
  }

  // 8. BR-15: Keputusan otomatis 'hadir' vs 'terlambat' berdasarkan waktu server
  const isLate = nowSeconds > lateAfterSeconds;
  const status: "hadir" | "terlambat" = isLate ? "terlambat" : "hadir";
  const lateMinutes: number | null = isLate
    ? Math.max(1, Math.ceil((nowSeconds - lateAfterSeconds) / 60))
    : null;

  const attemptId = await insertAttemptRow({
    ...baseAttemptData,
    faceSimilarity: aiResult.similarityMax,
    faceResult: "match",
    outcome: "recorded",
    modelVersion: aiResult.modelVersion ?? activeTemplates.modelVersion,
  });

  const serverNowSql = toMysqlDateTime(serverNow);
  let recordId: number;

  if (existingRecords.length > 0 && existingRecords[0].status === "alpa") {
    // Jika sebelumnya sudah ada baris alpa pada tanggal ini, perbarui menjadi hadir/terlambat
    recordId = Number(existingRecords[0].id);
    await database.execute(
      `UPDATE attendance_records
       SET status = ?,
           source = 'face_gps',
           check_in_at = ?,
           late_minutes = ?,
           attempt_id = ?
       WHERE id = ?`,
      [status, serverNowSql, lateMinutes, attemptId, recordId]
    );
  } else {
    const [recRes] = await database.execute<ResultSetHeader>(
      `INSERT INTO attendance_records
         (student_id, attendance_date, status, source, check_in_at, late_minutes, attempt_id)
       VALUES (?, ?, ?, 'face_gps', ?, ?, ?)`,
      [
        studentRosterId,
        todayWib,
        status,
        serverNowSql,
        lateMinutes,
        attemptId,
      ]
    );
    recordId = Number(recRes.insertId);
  }

  // Tautkan record_id kembali ke baris attendance_attempts
  await database.execute(
    `UPDATE attendance_attempts SET record_id = ? WHERE id = ?`,
    [recordId, attemptId]
  );

  // BR-50a: Kirim notifikasi presensi berhasil tercatat ke siswa
  await NotificationService.notifyAttendanceRecorded({
    studentUserId,
    recordId,
    status,
    date: todayWib,
    lateMinutes,
  });

  return {
    record: {
      id: recordId,
      date: todayWib,
      status,
      check_in_at: serverNow.toISOString(),
      late_minutes: lateMinutes,
    },
    requires_late_reason: isLate,
    late_reason_options: [...LATE_REASON_OPTIONS],
    face: {
      similarity: aiResult.similarityMax,
    },
    geofence: {
      distance_m: geofenceEval.distance_m,
      radius_m: geofenceEval.radius_m,
    },
    message: "Absensi Masuk Berhasil!",
  };
}

/**
 * US-12, BR-18 & FSD §5.4 — PATCH /api/attendance/:id/late-reason
 * Siswa mengirimkan alasan keterlambatan pada record presensi miliknya yang berstatus `terlambat`.
 */
export async function submitLateAttendanceReason(params: {
  recordId: number;
  studentRosterId: number;
  payload: unknown;
}) {
  if (!Number.isSafeInteger(params.recordId) || params.recordId <= 0) {
    throw new AppError("ID presensi tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { id: "ID presensi harus berupa bilangan bulat positif." },
    });
  }

  if (
    typeof params.payload !== "object" ||
    params.payload === null ||
    Array.isArray(params.payload)
  ) {
    throw new AppError("Format alasan terlambat tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { _form: "Body request harus berupa objek JSON." },
    });
  }

  const body = params.payload as Record<string, unknown>;
  const rawReason = String(
    body.reason ?? body.late_reason ?? body.lateReason ?? ""
  )
    .trim()
    .toLowerCase();
  const rawNote = body.note ?? body.late_note ?? body.lateNote;

  const errors: Record<string, string> = {};
  if (!LATE_REASON_OPTIONS.includes(rawReason as LateReasonOption)) {
    errors.reason = `Pilih alasan terlambat yang valid: ${LATE_REASON_OPTIONS.join(", ")}.`;
  }

  let lateNote: string | null = null;
  if (rawNote !== undefined && rawNote !== null && rawNote !== "") {
    if (typeof rawNote !== "string") {
      errors.note = "Catatan tambahan harus berupa teks.";
    } else if (rawNote.trim().length > 120) {
      errors.note = "Catatan alasan terlambat maksimal 120 karakter.";
    } else {
      lateNote = rawNote.trim() || null;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi alasan terlambat gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  const [rows] = await database.execute<AttendanceRecordRow[]>(
    `SELECT *
     FROM attendance_records
     WHERE id = ?
     LIMIT 1`,
    [params.recordId]
  );

  // FSD §2 & §5.4: Hanya pemilik; 404 bila tidak ditemukan atau bukan milik siswa pemanggil
  if (
    rows.length === 0 ||
    Number(rows[0].student_id) !== params.studentRosterId
  ) {
    throw new AppError("Data presensi tidak ditemukan.", 404, {
      code: "NOT_FOUND",
    });
  }

  const record = rows[0];
  if (record.status !== "terlambat") {
    throw new AppError(
      "Alasan terlambat hanya dapat diisi untuk presensi berstatus terlambat.",
      422,
      { code: "NOT_LATE" }
    );
  }

  await database.execute(
    `UPDATE attendance_records
     SET late_reason = ?,
         late_note = ?
     WHERE id = ? AND student_id = ?`,
    [rawReason, lateNote, params.recordId, params.studentRosterId]
  );

  const [updatedRows] = await database.execute<AttendanceRecordRow[]>(
    `SELECT *
     FROM attendance_records
     WHERE id = ?
     LIMIT 1`,
    [params.recordId]
  );

  const updated = updatedRows[0] ?? {
    ...record,
    late_reason: rawReason as LateReasonOption,
    late_note: lateNote,
  };

  return {
    id: Number(updated.id),
    student_id: Number(updated.student_id),
    date: formatDateYmd(updated.attendance_date),
    status: updated.status,
    source: updated.source,
    check_in_at: toIsoStringOrNull(updated.check_in_at),
    late_minutes:
      updated.late_minutes !== null && updated.late_minutes !== undefined
        ? Number(updated.late_minutes)
        : null,
    late_reason: updated.late_reason ?? null,
    late_note: updated.late_note ?? null,
  };
}
