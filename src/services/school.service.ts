import { RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";
import { getDayOfWeekIso, nowUtc, toWibDate } from "../utils/wib-time";

const DAY_NAMES: Record<number, string> = {
  1: "Senin",
  2: "Selasa",
  3: "Rabu",
  4: "Kamis",
  5: "Jumat",
  6: "Sabtu",
  7: "Minggu",
};

export interface GeofenceConfig {
  latitude: number;
  longitude: number;
  radius_m: number;
}

export interface DayScheduleItem {
  day_of_week: number;
  day_name: string;
  is_school_day: boolean;
  checkin_open: string | null;
  late_after: string | null;
  checkin_close: string | null;
}

export interface TodayScheduleConfig {
  date: string;
  day_of_week: number;
  day_name: string;
  is_school_day: boolean;
  checkin_open: string | null;
  late_after: string | null;
  checkin_close: string | null;
  holiday_title: string | null;
}

export interface SchoolConfigResult {
  school_name: string;
  timezone: string;
  geofence: GeofenceConfig;
  today: TodayScheduleConfig;
  schedules: DayScheduleItem[];
  updated_at?: string;
}

const DEFAULT_SCHOOL_SETTINGS = {
  school_name: "MTs Al-Ma'arif",
  latitude: -7.9826,
  longitude: 112.6308,
  radius_m: 15,
  timezone: "Asia/Jakarta",
};

const DEFAULT_SCHEDULES: Array<{
  day_of_week: number;
  is_school_day: boolean;
  checkin_open: string | null;
  late_after: string | null;
  checkin_close: string | null;
}> = [
  { day_of_week: 1, is_school_day: true, checkin_open: "06:00", late_after: "07:15", checkin_close: "12:00" },
  { day_of_week: 2, is_school_day: true, checkin_open: "06:00", late_after: "07:15", checkin_close: "12:00" },
  { day_of_week: 3, is_school_day: true, checkin_open: "06:00", late_after: "07:15", checkin_close: "12:00" },
  { day_of_week: 4, is_school_day: true, checkin_open: "06:00", late_after: "07:15", checkin_close: "12:00" },
  { day_of_week: 5, is_school_day: true, checkin_open: "06:00", late_after: "07:15", checkin_close: "11:30" },
  { day_of_week: 6, is_school_day: true, checkin_open: "06:00", late_after: "07:15", checkin_close: "12:00" },
  { day_of_week: 7, is_school_day: false, checkin_open: null, late_after: null, checkin_close: null },
];

function validationError(
  message: string,
  errors: Record<string, string>
): never {
  throw new AppError(message, 400, {
    code: "VALIDATION_ERROR",
    errors,
  });
}

function asObject(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    validationError("Data permintaan tidak valid.", {
      _form: "Body permintaan harus berupa objek JSON.",
    });
  }
  return payload as Record<string, unknown>;
}

/**
 * Validates `HH:mm` or `HH:mm:ss` and normalizes to `HH:mm`.
 */
export function normalizeTimeHm(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  return `${match[1]}:${match[2]}`;
}

function timeToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Ensures the singleton row in `school_settings` and 7 rows in `attendance_schedules` exist.
 */
async function ensureDefaultSchoolTablesSeeded(): Promise<void> {
  await database.execute(
    `INSERT IGNORE INTO school_settings (id, school_name, latitude, longitude, radius_m, timezone)
     VALUES (1, ?, ?, ?, ?, ?)`,
    [
      DEFAULT_SCHOOL_SETTINGS.school_name,
      DEFAULT_SCHOOL_SETTINGS.latitude,
      DEFAULT_SCHOOL_SETTINGS.longitude,
      DEFAULT_SCHOOL_SETTINGS.radius_m,
      DEFAULT_SCHOOL_SETTINGS.timezone,
    ]
  );

  await database.execute(
    `UPDATE school_settings SET radius_m = 15 WHERE id = 1 AND radius_m > 15`
  );

  for (const s of DEFAULT_SCHEDULES) {
    await database.execute(
      `INSERT IGNORE INTO attendance_schedules (day_of_week, is_school_day, checkin_open, late_after, checkin_close)
       VALUES (?, ?, ?, ?, ?)`,
      [
        s.day_of_week,
        s.is_school_day ? 1 : 0,
        s.checkin_open ? `${s.checkin_open}:00` : null,
        s.late_after ? `${s.late_after}:00` : null,
        s.checkin_close ? `${s.checkin_close}:00` : null,
      ]
    );
  }
}

/**
 * Fetches all 7 day schedules (1=Senin .. 7=Minggu).
 */
export async function getAllAttendanceSchedules(): Promise<DayScheduleItem[]> {
  await ensureDefaultSchoolTablesSeeded();

  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT
       day_of_week,
       is_school_day,
       TIME_FORMAT(checkin_open, '%H:%i') AS checkin_open,
       TIME_FORMAT(late_after, '%H:%i') AS late_after,
       TIME_FORMAT(checkin_close, '%H:%i') AS checkin_close
     FROM attendance_schedules
     ORDER BY day_of_week ASC`
  );

  const byDay = new Map<number, DayScheduleItem>();
  for (const d of DEFAULT_SCHEDULES) {
    byDay.set(d.day_of_week, {
      day_of_week: d.day_of_week,
      day_name: DAY_NAMES[d.day_of_week] ?? `Hari-${d.day_of_week}`,
      is_school_day: d.is_school_day,
      checkin_open: d.checkin_open,
      late_after: d.late_after,
      checkin_close: d.checkin_close,
    });
  }

  for (const row of rows) {
    const dayNum = Number(row.day_of_week);
    if (dayNum >= 1 && dayNum <= 7) {
      byDay.set(dayNum, {
        day_of_week: dayNum,
        day_name: DAY_NAMES[dayNum] ?? `Hari-${dayNum}`,
        is_school_day: Boolean(row.is_school_day),
        checkin_open: (row.checkin_open as string | null) ?? null,
        late_after: (row.late_after as string | null) ?? null,
        checkin_close: (row.checkin_close as string | null) ?? null,
      });
    }
  }

  return Array.from(byDay.values()).sort((a, b) => a.day_of_week - b.day_of_week);
}

/**
 * Checks if a given `YYYY-MM-DD` date has an active published holiday announcement (BR-10, BR-41).
 */
export async function getHolidayAnnouncementOnDate(
  dateStr: string
): Promise<{ id: number; title: string } | null> {
  try {
    const [rows] = await database.execute<RowDataPacket[]>(
      `SELECT id, title
       FROM announcements
       WHERE status = 'published'
         AND deleted_at IS NULL
         AND category = 'holiday'
         AND publish_date <= ?
         AND COALESCE(end_date, publish_date) >= ?
       ORDER BY publish_date DESC, id DESC
       LIMIT 1`,
      [dateStr, dateStr]
    );
    if (rows.length > 0) {
      return {
        id: Number(rows[0].id),
        title: String(rows[0].title),
      };
    }
  } catch {
    // Ignore if announcements table does not exist yet
  }
  return null;
}

/**
 * GET /api/school/config (P0 — FSD §5.2)
 * Mengembalikan nama sekolah, zona waktu, geofence (lat, lng, radius_m),
 * konfigurasi jadwal hari ini (`today`), dan daftar jadwal 7 hari (`schedules`).
 */
export async function getSchoolConfig(): Promise<SchoolConfigResult> {
  await ensureDefaultSchoolTablesSeeded();

  const [settingsRows, schedules] = await Promise.all([
    database
      .execute<RowDataPacket[]>(
        `SELECT id, school_name, latitude, longitude, radius_m, timezone, updated_at
         FROM school_settings
         WHERE id = 1
         LIMIT 1`
      )
      .then(([rows]) => rows),
    getAllAttendanceSchedules(),
  ]);

  const settings = settingsRows[0];
  const schoolName = settings
    ? String(settings.school_name)
    : DEFAULT_SCHOOL_SETTINGS.school_name;
  const timezone = settings
    ? String(settings.timezone)
    : DEFAULT_SCHOOL_SETTINGS.timezone;
  const latitude = settings
    ? Number(settings.latitude)
    : DEFAULT_SCHOOL_SETTINGS.latitude;
  const longitude = settings
    ? Number(settings.longitude)
    : DEFAULT_SCHOOL_SETTINGS.longitude;
  const radiusM = settings
    ? Number(settings.radius_m)
    : DEFAULT_SCHOOL_SETTINGS.radius_m;

  const todayDate = toWibDate(nowUtc());
  const todayDayOfWeek = getDayOfWeekIso(todayDate);
  const todaySchedule =
    schedules.find((s) => s.day_of_week === todayDayOfWeek) ??
    DEFAULT_SCHEDULES[todayDayOfWeek - 1];

  const holiday = await getHolidayAnnouncementOnDate(todayDate);
  // BR-10: Hari sekolah jika is_school_day = true pada jadwal DAN tidak ada pengumuman libur
  const isSchoolDayToday = Boolean(todaySchedule.is_school_day) && !holiday;

  return {
    school_name: schoolName,
    timezone,
    geofence: {
      latitude,
      longitude,
      radius_m: radiusM,
    },
    today: {
      date: todayDate,
      day_of_week: todayDayOfWeek,
      day_name: DAY_NAMES[todayDayOfWeek] ?? `Hari-${todayDayOfWeek}`,
      is_school_day: isSchoolDayToday,
      checkin_open: todaySchedule.checkin_open,
      late_after: todaySchedule.late_after,
      checkin_close: todaySchedule.checkin_close,
      holiday_title: holiday ? holiday.title : null,
    },
    schedules,
    ...(settings?.updated_at
      ? { updated_at: new Date(settings.updated_at).toISOString() }
      : {}),
  };
}

/**
 * PATCH /api/school/geofence (P1 — Admin, US-70 AC3, FSD §5.2)
 * Memperbarui koordinat pusat sekolah, radius geofence, dan/atau nama sekolah pada `school_settings`.
 */
export async function updateSchoolGeofence(
  payload: unknown
): Promise<SchoolConfigResult> {
  await ensureDefaultSchoolTablesSeeded();
  const body = asObject(payload);
  const errors: Record<string, string> = {};

  const [existingRows] = await database.execute<RowDataPacket[]>(
    `SELECT school_name, latitude, longitude, radius_m, timezone
     FROM school_settings
     WHERE id = 1
     LIMIT 1`
  );
  const current = existingRows[0] ?? DEFAULT_SCHOOL_SETTINGS;

  const hasAnyField = ["latitude", "longitude", "radius_m", "school_name", "timezone"].some(
    (key) => Object.prototype.hasOwnProperty.call(body, key)
  );
  if (!hasAnyField) {
    validationError("Tidak ada perubahan konfigurasi geofence yang dikirim.", {
      _form: "Minimal satu field (latitude, longitude, radius_m, school_name, atau timezone) wajib dikirim.",
    });
  }

  let latitude = Number(current.latitude);
  if (Object.prototype.hasOwnProperty.call(body, "latitude")) {
    const rawLat = body.latitude;
    const parsedLat =
      typeof rawLat === "number"
        ? rawLat
        : typeof rawLat === "string" && rawLat.trim() !== ""
          ? Number(rawLat)
          : Number.NaN;
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      errors.latitude = "Latitude wajib berupa angka desimal antara -90 hingga 90.";
    } else {
      latitude = Number(parsedLat.toFixed(6));
    }
  }

  let longitude = Number(current.longitude);
  if (Object.prototype.hasOwnProperty.call(body, "longitude")) {
    const rawLng = body.longitude;
    const parsedLng =
      typeof rawLng === "number"
        ? rawLng
        : typeof rawLng === "string" && rawLng.trim() !== ""
          ? Number(rawLng)
          : Number.NaN;
    if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      errors.longitude = "Longitude wajib berupa angka desimal antara -180 hingga 180.";
    } else {
      longitude = Number(parsedLng.toFixed(6));
    }
  }

  let radiusM = Number(current.radius_m);
  if (Object.prototype.hasOwnProperty.call(body, "radius_m")) {
    const rawRadius = body.radius_m;
    const parsedRadius =
      typeof rawRadius === "number"
        ? rawRadius
        : typeof rawRadius === "string" && /^\d+$/.test(rawRadius.trim())
          ? Number(rawRadius.trim())
          : Number.NaN;
    if (
      !Number.isSafeInteger(parsedRadius) ||
      parsedRadius < 1 ||
      parsedRadius > 15
    ) {
      errors.radius_m =
        "Radius presensi wajib berupa bilangan bulat antara 1 hingga 15 meter.";
    } else {
      radiusM = parsedRadius;
    }
  } else if (radiusM > 15) {
    radiusM = 15;
  }

  let schoolName = String(current.school_name);
  if (Object.prototype.hasOwnProperty.call(body, "school_name")) {
    const rawName = body.school_name;
    const trimmed = typeof rawName === "string" ? rawName.trim() : "";
    if (!trimmed || trimmed.length < 3 || trimmed.length > 150) {
      errors.school_name = "Nama sekolah wajib diisi antara 3 hingga 150 karakter.";
    } else {
      schoolName = trimmed;
    }
  }

  let timezone = String(current.timezone);
  if (Object.prototype.hasOwnProperty.call(body, "timezone")) {
    const rawTz = body.timezone;
    const trimmed = typeof rawTz === "string" ? rawTz.trim() : "";
    if (!trimmed || trimmed.length > 40) {
      errors.timezone = "Timezone wajib berupa teks valid maksimal 40 karakter.";
    } else {
      timezone = trimmed;
    }
  }

  if (Object.keys(errors).length > 0) {
    validationError("Validasi konfigurasi geofence gagal.", errors);
  }

  await database.execute(
    `UPDATE school_settings
     SET school_name = ?, latitude = ?, longitude = ?, radius_m = ?, timezone = ?
     WHERE id = 1`,
    [schoolName, latitude, longitude, radiusM, timezone]
  );

  return getSchoolConfig();
}

/**
 * PUT /api/school/schedule/:dayOfWeek (P1 — Admin, US-70 AC3, FSD §5.2)
 * Mengatur jadwal hari sekolah & jam presensi untuk `dayOfWeek` (1=Senin .. 7=Minggu).
 */
export async function updateSchoolScheduleByDay(
  dayParam: unknown,
  payload: unknown
): Promise<{
  schedule: DayScheduleItem;
  today: TodayScheduleConfig;
}> {
  await ensureDefaultSchoolTablesSeeded();

  const dayOfWeek =
    typeof dayParam === "number"
      ? dayParam
      : typeof dayParam === "string" && /^\d+$/.test(dayParam.trim())
        ? Number(dayParam.trim())
        : Number.NaN;

  if (!Number.isSafeInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    validationError("Parameter hari tidak valid.", {
      day_of_week: "Hari harus berupa angka 1 (Senin) hingga 7 (Minggu).",
    });
  }

  const body = asObject(payload);
  const errors: Record<string, string> = {};

  const [existingRows] = await database.execute<RowDataPacket[]>(
    `SELECT
       day_of_week,
       is_school_day,
       TIME_FORMAT(checkin_open, '%H:%i') AS checkin_open,
       TIME_FORMAT(late_after, '%H:%i') AS late_after,
       TIME_FORMAT(checkin_close, '%H:%i') AS checkin_close
     FROM attendance_schedules
     WHERE day_of_week = ?
     LIMIT 1`,
    [dayOfWeek]
  );

  const current = existingRows[0] ?? DEFAULT_SCHEDULES[dayOfWeek - 1];

  let isSchoolDay: boolean;
  if (Object.prototype.hasOwnProperty.call(body, "is_school_day")) {
    if (typeof body.is_school_day === "boolean") {
      isSchoolDay = body.is_school_day;
    } else if (body.is_school_day === 1 || body.is_school_day === "true") {
      isSchoolDay = true;
    } else if (body.is_school_day === 0 || body.is_school_day === "false") {
      isSchoolDay = false;
    } else {
      errors.is_school_day = "Field is_school_day harus berupa boolean (true/false).";
      isSchoolDay = Boolean(current.is_school_day);
    }
  } else {
    isSchoolDay = Boolean(current.is_school_day);
  }

  const resolveTimeField = (
    fieldKey: "checkin_open" | "late_after" | "checkin_close",
    label: string,
    fallback: string | null
  ): string | null => {
    if (!Object.prototype.hasOwnProperty.call(body, fieldKey)) {
      return isSchoolDay ? fallback : null;
    }
    const raw = body[fieldKey];
    if (raw === null || raw === "") {
      if (isSchoolDay) {
        errors[fieldKey] = `${label} wajib diisi untuk hari sekolah (format HH:mm).`;
      }
      return null;
    }
    const normalized = normalizeTimeHm(raw);
    if (!normalized) {
      errors[fieldKey] = `${label} harus berformat HH:mm (contoh: 07:15).`;
      return null;
    }
    return normalized;
  };

  let checkinOpen = resolveTimeField(
    "checkin_open",
    "Waktu buka presensi (checkin_open)",
    (current.checkin_open as string | null) ?? "06:00"
  );
  let lateAfter = resolveTimeField(
    "late_after",
    "Batas waktu terlambat (late_after)",
    (current.late_after as string | null) ?? "07:15"
  );
  let checkinClose = resolveTimeField(
    "checkin_close",
    "Waktu tutup presensi (checkin_close)",
    (current.checkin_close as string | null) ?? "12:00"
  );

  if (isSchoolDay) {
    if (!checkinOpen && !errors.checkin_open) {
      errors.checkin_open =
        "Waktu buka presensi (checkin_open) wajib diisi untuk hari sekolah (format HH:mm).";
    }
    if (!lateAfter && !errors.late_after) {
      errors.late_after =
        "Batas waktu terlambat (late_after) wajib diisi untuk hari sekolah (format HH:mm).";
    }
    if (!checkinClose && !errors.checkin_close) {
      errors.checkin_close =
        "Waktu tutup presensi (checkin_close) wajib diisi untuk hari sekolah (format HH:mm).";
    }

    if (checkinOpen && lateAfter && checkinClose) {
      const openMin = timeToMinutes(checkinOpen);
      const lateMin = timeToMinutes(lateAfter);
      const closeMin = timeToMinutes(checkinClose);

      if (lateMin < openMin) {
        errors.late_after =
          "Batas waktu terlambat (late_after) tidak boleh lebih awal dari waktu buka presensi (checkin_open).";
      }
      if (closeMin <= lateMin) {
        errors.checkin_close =
          "Waktu tutup presensi (checkin_close) harus setelah batas waktu terlambat (late_after).";
      }
    }
  } else {
    // Jika bukan hari sekolah dan tidak dikirim jam eksplisit, kosongkan jam
    if (!Object.prototype.hasOwnProperty.call(body, "checkin_open")) {
      checkinOpen = null;
    }
    if (!Object.prototype.hasOwnProperty.call(body, "late_after")) {
      lateAfter = null;
    }
    if (!Object.prototype.hasOwnProperty.call(body, "checkin_close")) {
      checkinClose = null;
    }
  }

  if (Object.keys(errors).length > 0) {
    validationError("Validasi jadwal presensi gagal.", errors);
  }

  await database.execute(
    `INSERT INTO attendance_schedules (day_of_week, is_school_day, checkin_open, late_after, checkin_close)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_school_day = VALUES(is_school_day),
       checkin_open = VALUES(checkin_open),
       late_after = VALUES(late_after),
       checkin_close = VALUES(checkin_close)`,
    [
      dayOfWeek,
      isSchoolDay ? 1 : 0,
      checkinOpen ? `${checkinOpen}:00` : null,
      lateAfter ? `${lateAfter}:00` : null,
      checkinClose ? `${checkinClose}:00` : null,
    ]
  );

  const config = await getSchoolConfig();
  const updatedSchedule =
    config.schedules.find((s) => s.day_of_week === dayOfWeek) ?? {
      day_of_week: dayOfWeek,
      day_name: DAY_NAMES[dayOfWeek] ?? `Hari-${dayOfWeek}`,
      is_school_day: isSchoolDay,
      checkin_open: checkinOpen,
      late_after: lateAfter,
      checkin_close: checkinClose,
    };

  return {
    schedule: updatedSchedule,
    today: config.today,
  };
}
