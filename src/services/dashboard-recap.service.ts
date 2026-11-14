import { RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";
import { getDayOfWeekIso, nowUtc, toWibDate } from "../utils/wib-time";
import { CATEGORY_TO_TYPE, PRIORITY_TO_FSD } from "./announcement.service";
import { ensureAttendanceAttemptsTable } from "./attendance.service";
import { getAllAttendanceSchedules, getSchoolConfig } from "./school.service";

const VALID_CLASS_DETAIL_STATUSES = [
  "hadir",
  "terlambat",
  "izin",
  "sakit",
  "alpa",
  "belum_hadir",
] as const;

export type ClassDetailStudentStatus =
  (typeof VALID_CLASS_DETAIL_STATUSES)[number];

const LATE_REASON_LABELS: Record<string, string> = {
  macet: "Macet Lalu Lintas",
  kendala_kendaraan: "Kendala Kendaraan",
  keperluan_keluarga: "Keperluan Keluarga",
  lainnya: "Lainnya",
};

function getReportMaxRangeDays(): number {
  const raw = Number(process.env.REPORT_MAX_RANGE_DAYS ?? 92);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 92;
}

function getClassAlertThreshold(): number {
  const raw = Number(process.env.CLASS_ALERT_THRESHOLD ?? 95);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 95;
}

function isValidCalendarDateYmd(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function parseAndValidateDate(
  rawDate: unknown,
  fieldName = "date"
): string {
  if (rawDate === undefined || rawDate === null || String(rawDate).trim() === "") {
    return toWibDate(nowUtc());
  }
  const trimmed = String(rawDate).trim();
  if (!isValidCalendarDateYmd(trimmed)) {
    throw new AppError(`Format ${fieldName} tidak valid. Gunakan YYYY-MM-DD.`, 400, {
      code: "VALIDATION_ERROR",
      errors: {
        [fieldName]: `Format ${fieldName} harus YYYY-MM-DD yang valid.`,
      },
    });
  }
  return trimmed;
}

export function parseAndValidateDateRange(
  fromParam: unknown,
  toParam: unknown
): { from: string; to: string; dates: string[] } {
  const todayWib = toWibDate(nowUtc());
  const rawFrom =
    fromParam !== undefined && fromParam !== null && String(fromParam).trim() !== ""
      ? String(fromParam).trim()
      : todayWib;
  const rawTo =
    toParam !== undefined && toParam !== null && String(toParam).trim() !== ""
      ? String(toParam).trim()
      : rawFrom;

  const errors: Record<string, string> = {};
  if (!isValidCalendarDateYmd(rawFrom)) {
    errors.from = "Format tanggal awal (from) harus YYYY-MM-DD yang valid.";
  }
  if (!isValidCalendarDateYmd(rawTo)) {
    errors.to = "Format tanggal akhir (to) harus YYYY-MM-DD yang valid.";
  }
  if (Object.keys(errors).length > 0) {
    throw new AppError("Rentang tanggal tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  if (rawFrom > rawTo) {
    throw new AppError(
      "Tanggal awal (from) tidak boleh lebih besar dari tanggal akhir (to).",
      400,
      {
        code: "VALIDATION_ERROR",
        errors: {
          from: "Tanggal awal (from) harus <= tanggal akhir (to).",
        },
      }
    );
  }

  const [fy, fm, fd] = rawFrom.split("-").map(Number);
  const [ty, tm, td] = rawTo.split("-").map(Number);
  const startUtcMs = Date.UTC(fy, fm - 1, fd);
  const endUtcMs = Date.UTC(ty, tm - 1, td);
  const totalDays = Math.floor((endUtcMs - startUtcMs) / (1000 * 60 * 60 * 24)) + 1;
  const maxDays = getReportMaxRangeDays();

  if (totalDays > maxDays) {
    throw new AppError(
      `Rentang tanggal maksimal adalah ${maxDays} hari.`,
      400,
      {
        code: "VALIDATION_ERROR",
        errors: {
          to: `Rentang tanggal tidak boleh melebihi ${maxDays} hari.`,
        },
      }
    );
  }

  const dates: string[] = [];
  for (let i = 0; i < totalDays; i++) {
    const cur = new Date(startUtcMs + i * 24 * 60 * 60 * 1000);
    dates.push(cur.toISOString().slice(0, 10));
  }

  return { from: rawFrom, to: rawTo, dates };
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

function extractClassSection(className: string, gradeLevel: number): string {
  const trimmed = className.trim();
  const gradeStr = String(gradeLevel);
  if (trimmed.toLowerCase().startsWith(`kelas ${gradeStr}`)) {
    return trimmed.slice(`kelas ${gradeStr}`.length).trim();
  }
  if (trimmed.startsWith(gradeStr)) {
    return trimmed.slice(gradeStr.length).trim();
  }
  return "";
}

function formatStudentAttendanceNote(params: {
  status: ClassDetailStudentStatus;
  lateMinutes?: number | null;
  lateReason?: string | null;
  lateNote?: string | null;
}): string | null {
  const { status, lateMinutes, lateReason, lateNote } = params;
  if (status === "hadir") {
    return "Tepat Waktu";
  }
  if (status === "terlambat") {
    const minsPart =
      lateMinutes !== null && lateMinutes !== undefined && lateMinutes > 0
        ? ` (${lateMinutes} menit)`
        : "";
    const reasonLabel = lateReason
      ? (LATE_REASON_LABELS[lateReason] ?? lateReason)
      : "";
    const detailPart =
      lateNote && lateNote.trim() !== ""
        ? reasonLabel
          ? `${reasonLabel}: ${lateNote.trim()}`
          : lateNote.trim()
        : reasonLabel;
    return detailPart
      ? `Terlambat${minsPart} - ${detailPart}`
      : `Terlambat${minsPart}`;
  }
  if (status === "izin") {
    return "Izin";
  }
  if (status === "sakit") {
    return "Sakit";
  }
  if (status === "alpa") {
    return "Tanpa Keterangan";
  }
  return null;
}

async function computeSchoolDaysInDates(dates: string[]): Promise<{
  schoolDays: Set<string>;
  schoolDaysCount: number;
}> {
  if (dates.length === 0) {
    return { schoolDays: new Set(), schoolDaysCount: 0 };
  }
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const [schedules, holidayRows] = await Promise.all([
    getAllAttendanceSchedules(),
    database
      .execute<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(publish_date, '%Y-%m-%d') AS start_date,
           DATE_FORMAT(COALESCE(end_date, publish_date), '%Y-%m-%d') AS end_date
         FROM announcements
         WHERE status = 'published'
           AND deleted_at IS NULL
           AND category = 'holiday'
           AND publish_date <= ?
           AND COALESCE(end_date, publish_date) >= ?`,
        [lastDate, firstDate]
      )
      .then(([rows]) => rows)
      .catch(() => [] as RowDataPacket[]),
  ]);

  const scheduleByDay = new Map<number, boolean>();
  for (const s of schedules) {
    scheduleByDay.set(s.day_of_week, Boolean(s.is_school_day));
  }

  const schoolDays = new Set<string>();
  for (const d of dates) {
    const isoDay = getDayOfWeekIso(d);
    const isScheduledSchoolDay = scheduleByDay.get(isoDay) ?? isoDay <= 6;
    if (!isScheduledSchoolDay) {
      continue;
    }
    const isHoliday = holidayRows.some((h) => {
      const start = String(h.start_date);
      const end = String(h.end_date ?? h.start_date);
      return d >= start && d <= end;
    });
    if (!isHoliday) {
      schoolDays.add(d);
    }
  }

  return {
    schoolDays,
    schoolDaysCount: schoolDays.size,
  };
}

interface ClassRow extends RowDataPacket {
  id: number;
  name: string;
  grade_level: number;
}

interface ActiveStudentRow extends RowDataPacket {
  id: number;
  nisn: string;
  full_name: string;
  class_id: number | null;
  attendance_number: number | null;
}

interface AttendanceRecordSummaryRow extends RowDataPacket {
  id: number;
  student_id: number;
  attendance_date: string;
  status: "hadir" | "terlambat" | "izin" | "sakit" | "alpa";
  source: string;
  check_in_at: Date | string | null;
  late_minutes: number | null;
  late_reason: string | null;
  late_note: string | null;
  attempt_id: number | null;
}

/**
 * US-40, BR-30..32 & FSD §5.6 — GET /api/dashboard/summary?date=YYYY-MM-DD
 * Menampilkan 4 kartu statistik utama (`totals`), ringkasan per kelas (`classes`),
 * pengumuman terbaru (`announcements`), dan tanda kalender bulan berjalan (`calendar_marks`).
 */
export async function getDashboardSummary(query: { date?: unknown }) {
  const targetDate = parseAndValidateDate(query.date, "date");
  const targetMonth = targetDate.slice(0, 7);
  const monthStart = `${targetMonth}-01`;
  const [y, m] = targetMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${targetMonth}-${String(daysInMonth).padStart(2, "0")}`;

  const [
    schoolDaysInfo,
    classRows,
    studentRows,
    recordRows,
    announcementRows,
  ] = await Promise.all([
    computeSchoolDaysInDates([targetDate]),
    database
      .execute<ClassRow[]>(
        `SELECT id, name, grade_level
         FROM classes
         ORDER BY grade_level ASC, name ASC, id ASC`
      )
      .then(([rows]) => rows),
    database
      .execute<ActiveStudentRow[]>(
        `SELECT id, nisn, full_name, class_id, attendance_number
         FROM student_roster
         WHERE is_active = 1`
      )
      .then(([rows]) => rows),
    database
      .execute<AttendanceRecordSummaryRow[]>(
        `SELECT
           id,
           student_id,
           DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
           status,
           source,
           check_in_at,
           late_minutes,
           late_reason,
           late_note,
           attempt_id
         FROM attendance_records
         WHERE attendance_date = ?`,
        [targetDate]
      )
      .then(([rows]) => rows),
    database
      .execute<RowDataPacket[]>(
        `SELECT
           id,
           category,
           title,
           DATE_FORMAT(publish_date, '%Y-%m-%d') AS event_date,
           DATE_FORMAT(COALESCE(end_date, publish_date), '%Y-%m-%d') AS end_date,
           priority
         FROM announcements
         WHERE status = 'published'
           AND deleted_at IS NULL
           AND publish_date <= ?
           AND COALESCE(end_date, publish_date) >= ?
         ORDER BY publish_date DESC, id DESC`,
        [monthEnd, monthStart]
      )
      .then(([rows]) => rows)
      .catch(() => [] as RowDataPacket[]),
  ]);

  const recordByStudentId = new Map<number, AttendanceRecordSummaryRow>();
  for (const r of recordRows) {
    recordByStudentId.set(Number(r.student_id), r);
  }

  let totalHadir = 0;
  let totalTerlambat = 0;
  let totalIzin = 0;
  let totalSakit = 0;
  let totalAlpa = 0;
  let totalBelumHadir = 0;

  const studentsByClassId = new Map<number, ActiveStudentRow[]>();
  for (const st of studentRows) {
    const cid = st.class_id !== null ? Number(st.class_id) : 0;
    const list = studentsByClassId.get(cid) ?? [];
    list.push(st);
    studentsByClassId.set(cid, list);

    const rec = recordByStudentId.get(Number(st.id));
    if (!rec) {
      totalBelumHadir += 1;
    } else if (rec.status === "hadir") {
      totalHadir += 1;
    } else if (rec.status === "terlambat") {
      totalTerlambat += 1;
    } else if (rec.status === "izin") {
      totalIzin += 1;
    } else if (rec.status === "sakit") {
      totalSakit += 1;
    } else if (rec.status === "alpa") {
      totalAlpa += 1;
    }
  }

  const totalStudents = studentRows.length;
  const alertThreshold = getClassAlertThreshold();

  const classes = classRows.map((cls) => {
    const classId = Number(cls.id);
    const classStudents = studentsByClassId.get(classId) ?? [];
    const classTotal = classStudents.length;

    let hadir = 0;
    let terlambat = 0;
    let izin = 0;
    let sakit = 0;
    let alpa = 0;
    let belumHadir = 0;

    for (const st of classStudents) {
      const rec = recordByStudentId.get(Number(st.id));
      if (!rec) {
        belumHadir += 1;
      } else if (rec.status === "hadir") {
        hadir += 1;
      } else if (rec.status === "terlambat") {
        terlambat += 1;
      } else if (rec.status === "izin") {
        izin += 1;
      } else if (rec.status === "sakit") {
        sakit += 1;
      } else if (rec.status === "alpa") {
        alpa += 1;
      }
    }

    const attendanceCount = hadir + terlambat;
    const attendancePercent =
      classTotal > 0 ? Math.round((attendanceCount / classTotal) * 100) : 0;
    const status =
      classTotal === 0 || attendancePercent >= alertThreshold
        ? "Normal"
        : "Perlu Cek";

    const noteParts: string[] = [];
    if (terlambat > 0) noteParts.push(`${terlambat} Telat`);
    if (izin > 0) noteParts.push(`${izin} Izin`);
    if (sakit > 0) noteParts.push(`${sakit} Sakit`);
    if (alpa > 0) noteParts.push(`${alpa} Alpa`);
    if (belumHadir > 0) noteParts.push(`${belumHadir} Belum Hadir`);

    const grade = Number(cls.grade_level);
    const className = String(cls.name);

    return {
      class_id: classId,
      name: className,
      grade,
      section: extractClassSection(className, grade),
      total_students: classTotal,
      hadir,
      terlambat,
      izin,
      sakit,
      belum_hadir: belumHadir,
      alpa,
      attendance_count: attendanceCount,
      attendance_percent: attendancePercent,
      status,
      note: noteParts.length > 0 ? noteParts.join(", ") : null,
    };
  });

  const announcements = announcementRows.slice(0, 5).map((row) => {
    const category = String(row.category);
    const priority = String(row.priority);
    return {
      id: Number(row.id),
      type:
        CATEGORY_TO_TYPE[category as keyof typeof CATEGORY_TO_TYPE] ?? category,
      title: String(row.title),
      event_date: String(row.event_date),
      priority:
        PRIORITY_TO_FSD[priority as keyof typeof PRIORITY_TO_FSD] ?? priority,
    };
  });

  const marksByDate = new Map<string, string>();
  for (const row of announcementRows) {
    const category = String(row.category);
    const priority = String(row.priority);
    const eventDate = String(row.event_date);
    const markType =
      category === "holiday"
        ? "libur"
        : category === "important" ||
            priority === "important" ||
            priority === "urgent"
          ? "penting"
          : (CATEGORY_TO_TYPE[category as keyof typeof CATEGORY_TO_TYPE] ??
            "info");

    if (!marksByDate.has(eventDate) || markType === "libur") {
      marksByDate.set(eventDate, markType);
    }
  }

  const calendarMarks = Array.from(marksByDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, type]) => ({ date, type }));

  return {
    date: targetDate,
    generated_at: nowUtc().toISOString(),
    is_school_day: schoolDaysInfo.schoolDays.has(targetDate),
    totals: {
      total_students: totalStudents,
      sudah_hadir: totalHadir,
      terlambat_izin: {
        total: totalTerlambat + totalIzin + totalSakit,
        terlambat: totalTerlambat,
        izin: totalIzin,
        sakit: totalSakit,
      },
      belum_hadir_alpa: {
        total: totalBelumHadir + totalAlpa,
        belum_hadir: totalBelumHadir,
        alpa: totalAlpa,
      },
    },
    classes,
    announcements,
    calendar_marks: calendarMarks,
  };
}

/**
 * US-41, BR-31..35 & FSD §5.6 — GET /api/recap/overview?from=&to=
 * Ringkasan rekap kehadiran lintas kelas pada rentang tanggal.
 */
export async function getRecapOverview(query: {
  from?: unknown;
  to?: unknown;
  date?: unknown;
}) {
  await ensureAttendanceAttemptsTable();
  const range = parseAndValidateDateRange(
    query.from ?? query.date,
    query.to ?? query.date
  );

  const [
    schoolConfig,
    schoolDaysInfo,
    classRows,
    studentRows,
    recordRows,
    outsideAttemptRows,
  ] = await Promise.all([
    getSchoolConfig(),
    computeSchoolDaysInDates(range.dates),
    database
      .execute<ClassRow[]>(`SELECT id, name, grade_level FROM classes`)
      .then(([rows]) => rows),
    database
      .execute<ActiveStudentRow[]>(
        `SELECT id, nisn, full_name, class_id, attendance_number
         FROM student_roster
         WHERE is_active = 1`
      )
      .then(([rows]) => rows),
    database
      .execute<AttendanceRecordSummaryRow[]>(
        `SELECT
           ar.id,
           ar.student_id,
           DATE_FORMAT(ar.attendance_date, '%Y-%m-%d') AS attendance_date,
           ar.status,
           ar.source
         FROM attendance_records ar
         INNER JOIN student_roster sr ON sr.id = ar.student_id
         WHERE sr.is_active = 1
           AND ar.attendance_date >= ?
           AND ar.attendance_date <= ?`,
        [range.from, range.to]
      )
      .then(([rows]) => rows),
    database
      .execute<RowDataPacket[]>(
        `SELECT DISTINCT aa.student_id
         FROM attendance_attempts aa
         INNER JOIN student_roster sr ON sr.id = aa.student_id
         WHERE sr.is_active = 1
           AND aa.outcome = 'rejected_outside_radius'
           AND DATE(aa.attempted_at) >= ?
           AND DATE(aa.attempted_at) <= ?`,
        [range.from, range.to]
      )
      .then(([rows]) => rows)
      .catch(() => [] as RowDataPacket[]),
  ]);

  let hadir = 0;
  let terlambat = 0;
  let izin = 0;
  let sakit = 0;
  let alpa = 0;
  const monitoredStudentIds = new Set<number>();

  for (const r of recordRows) {
    if (r.status === "hadir") {
      hadir += 1;
      monitoredStudentIds.add(Number(r.student_id));
    } else if (r.status === "terlambat") {
      terlambat += 1;
      monitoredStudentIds.add(Number(r.student_id));
    } else if (r.status === "izin") {
      izin += 1;
    } else if (r.status === "sakit") {
      sakit += 1;
    } else if (r.status === "alpa") {
      alpa += 1;
    }
  }

  const activeStudentsCount = studentRows.length;
  const effectiveSchoolDays = Math.max(1, schoolDaysInfo.schoolDaysCount);
  const denominator = activeStudentsCount * effectiveSchoolDays;
  const attendanceAvgPercent =
    denominator > 0
      ? Math.min(100, Math.round(((hadir + terlambat) / denominator) * 100))
      : 0;

  return {
    from: range.from,
    to: range.to,
    monitored_classes: classRows.length,
    attendance_avg_percent: attendanceAvgPercent,
    leave_total: {
      izin,
      sakit,
      total: izin + sakit,
    },
    alpa_total: alpa,
    gps: {
      monitored_students: monitoredStudentIds.size,
      outside_radius_students: outsideAttemptRows.length,
      radius_m: schoolConfig.geofence.radius_m,
    },
  };
}

/**
 * US-41, BR-31..32 & FSD §5.6 — GET /api/recap/classes?from=&to=
 * Tabel rekap kehadiran seluruh kelas pada rentang tanggal.
 */
export async function getRecapClasses(query: {
  from?: unknown;
  to?: unknown;
  date?: unknown;
}) {
  const range = parseAndValidateDateRange(
    query.from ?? query.date,
    query.to ?? query.date
  );

  const [schoolDaysInfo, classRows, studentRows, recordRows] = await Promise.all([
    computeSchoolDaysInDates(range.dates),
    database
      .execute<ClassRow[]>(
        `SELECT id, name, grade_level
         FROM classes
         ORDER BY grade_level ASC, name ASC, id ASC`
      )
      .then(([rows]) => rows),
    database
      .execute<ActiveStudentRow[]>(
        `SELECT id, nisn, full_name, class_id, attendance_number
         FROM student_roster
         WHERE is_active = 1`
      )
      .then(([rows]) => rows),
    database
      .execute<AttendanceRecordSummaryRow[]>(
        `SELECT
           ar.id,
           ar.student_id,
           DATE_FORMAT(ar.attendance_date, '%Y-%m-%d') AS attendance_date,
           ar.status
         FROM attendance_records ar
         INNER JOIN student_roster sr ON sr.id = ar.student_id
         WHERE sr.is_active = 1
           AND ar.attendance_date >= ?
           AND ar.attendance_date <= ?`,
        [range.from, range.to]
      )
      .then(([rows]) => rows),
  ]);

  const studentsByClassId = new Map<number, ActiveStudentRow[]>();
  const studentClassMap = new Map<number, number>();
  for (const st of studentRows) {
    const cid = st.class_id !== null ? Number(st.class_id) : 0;
    const list = studentsByClassId.get(cid) ?? [];
    list.push(st);
    studentsByClassId.set(cid, list);
    studentClassMap.set(Number(st.id), cid);
  }

  const statsByClassId = new Map<
    number,
    { hadir: number; terlambat: number; izin: number; sakit: number; alpa: number }
  >();

  for (const r of recordRows) {
    const cid = studentClassMap.get(Number(r.student_id));
    if (cid === undefined) continue;
    const st = statsByClassId.get(cid) ?? {
      hadir: 0,
      terlambat: 0,
      izin: 0,
      sakit: 0,
      alpa: 0,
    };
    if (r.status === "hadir") st.hadir += 1;
    else if (r.status === "terlambat") st.terlambat += 1;
    else if (r.status === "izin") st.izin += 1;
    else if (r.status === "sakit") st.sakit += 1;
    else if (r.status === "alpa") st.alpa += 1;
    statsByClassId.set(cid, st);
  }

  const effectiveSchoolDays = Math.max(1, schoolDaysInfo.schoolDaysCount);
  const alertThreshold = getClassAlertThreshold();

  return classRows.map((cls) => {
    const classId = Number(cls.id);
    const totalStudents = (studentsByClassId.get(classId) ?? []).length;
    const st = statsByClassId.get(classId) ?? {
      hadir: 0,
      terlambat: 0,
      izin: 0,
      sakit: 0,
      alpa: 0,
    };
    const denominator = totalStudents * effectiveSchoolDays;
    const attendancePercent =
      denominator > 0
        ? Math.min(
            100,
            Math.round(((st.hadir + st.terlambat) / denominator) * 100)
          )
        : 0;
    const recordedTotal = st.hadir + st.terlambat + st.izin + st.sakit + st.alpa;
    const belumHadir = Math.max(0, denominator - recordedTotal);

    return {
      class_id: classId,
      name: String(cls.name),
      grade: Number(cls.grade_level),
      total_students: totalStudents,
      hadir: st.hadir,
      terlambat: st.terlambat,
      izin: st.izin,
      sakit: st.sakit,
      alpa: st.alpa,
      belum_hadir: belumHadir,
      attendance_percent: attendancePercent,
      status:
        totalStudents === 0 || attendancePercent >= alertThreshold
          ? "Normal"
          : "Perlu Cek",
    };
  });
}

/**
 * US-41 & FSD §5.6 — GET /api/recap/classes/:classId?date=&q=&status=
 * Detail kehadiran per siswa dalam satu kelas pada tanggal tertentu,
 * dilengkapi `record_id` dan `scan_id` (tautan ke `GET /api/face-scans/:scanId`).
 */
export async function getRecapClassDetail(params: {
  classId: number;
  date?: unknown;
  q?: unknown;
  status?: unknown;
}) {
  if (!Number.isSafeInteger(params.classId) || params.classId <= 0) {
    throw new AppError("ID kelas tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { classId: "ID kelas harus berupa bilangan bulat positif." },
    });
  }

  await ensureAttendanceAttemptsTable();
  const targetDate = parseAndValidateDate(params.date, "date");

  let filterStatus: ClassDetailStudentStatus | null = null;
  if (
    params.status !== undefined &&
    params.status !== null &&
    String(params.status).trim() !== ""
  ) {
    const rawStatus = String(params.status).trim().toLowerCase();
    if (
      !VALID_CLASS_DETAIL_STATUSES.includes(
        rawStatus as ClassDetailStudentStatus
      )
    ) {
      throw new AppError("Filter status kehadiran tidak valid.", 400, {
        code: "VALIDATION_ERROR",
        errors: {
          status: `Filter status harus salah satu dari: ${VALID_CLASS_DETAIL_STATUSES.join(", ")}.`,
        },
      });
    }
    filterStatus = rawStatus as ClassDetailStudentStatus;
  }

  const [classRows] = await database.execute<ClassRow[]>(
    `SELECT id, name, grade_level FROM classes WHERE id = ? LIMIT 1`,
    [params.classId]
  );

  if (classRows.length === 0) {
    throw new AppError("Kelas tidak ditemukan.", 404, {
      code: "NOT_FOUND",
    });
  }

  const cls = classRows[0];

  const [studentRows, recordRows, attemptRows] = await Promise.all([
    database
      .execute<ActiveStudentRow[]>(
        `SELECT id, nisn, full_name, class_id, attendance_number
         FROM student_roster
         WHERE class_id = ? AND is_active = 1
         ORDER BY COALESCE(attendance_number, 999999) ASC, full_name ASC, id ASC`,
        [params.classId]
      )
      .then(([rows]) => rows),
    database
      .execute<AttendanceRecordSummaryRow[]>(
        `SELECT
           ar.id,
           ar.student_id,
           DATE_FORMAT(ar.attendance_date, '%Y-%m-%d') AS attendance_date,
           ar.status,
           ar.source,
           ar.check_in_at,
           ar.late_minutes,
           ar.late_reason,
           ar.late_note,
           ar.attempt_id
         FROM attendance_records ar
         INNER JOIN student_roster sr ON sr.id = ar.student_id
         WHERE sr.class_id = ?
           AND sr.is_active = 1
           AND ar.attendance_date = ?`,
        [params.classId, targetDate]
      )
      .then(([rows]) => rows),
    database
      .execute<RowDataPacket[]>(
        `SELECT aa.id AS scan_id, aa.student_id
         FROM attendance_attempts aa
         INNER JOIN student_roster sr ON sr.id = aa.student_id
         WHERE sr.class_id = ?
           AND sr.is_active = 1
           AND DATE(aa.attempted_at) = ?
         ORDER BY aa.attempted_at DESC, aa.id DESC`,
        [params.classId, targetDate]
      )
      .then(([rows]) => rows)
      .catch(() => [] as RowDataPacket[]),
  ]);

  const recordByStudentId = new Map<number, AttendanceRecordSummaryRow>();
  for (const r of recordRows) {
    recordByStudentId.set(Number(r.student_id), r);
  }

  const latestScanIdByStudentId = new Map<number, number>();
  for (const a of attemptRows) {
    const sid = Number(a.student_id);
    if (!latestScanIdByStudentId.has(sid)) {
      latestScanIdByStudentId.set(sid, Number(a.scan_id));
    }
  }

  const counts = {
    total_students: studentRows.length,
    hadir: 0,
    sakit: 0,
    izin: 0,
    alpa: 0,
    terlambat: 0,
    belum_hadir: 0,
  };

  const allStudentItems = studentRows.map((st) => {
    const sid = Number(st.id);
    const rec = recordByStudentId.get(sid);
    const status: ClassDetailStudentStatus = rec
      ? (rec.status as ClassDetailStudentStatus)
      : "belum_hadir";

    if (status === "hadir") counts.hadir += 1;
    else if (status === "terlambat") counts.terlambat += 1;
    else if (status === "izin") counts.izin += 1;
    else if (status === "sakit") counts.sakit += 1;
    else if (status === "alpa") counts.alpa += 1;
    else counts.belum_hadir += 1;

    const scanId =
      rec?.attempt_id !== null && rec?.attempt_id !== undefined
        ? Number(rec.attempt_id)
        : (latestScanIdByStudentId.get(sid) ?? null);

    return {
      nisn: String(st.nisn),
      name: String(st.full_name),
      absence_number:
        st.attendance_number !== null && st.attendance_number !== undefined
          ? Number(st.attendance_number)
          : null,
      status,
      check_in_at: rec ? toIsoStringOrNull(rec.check_in_at) : null,
      note: formatStudentAttendanceNote({
        status,
        lateMinutes: rec?.late_minutes ?? null,
        lateReason: rec?.late_reason ?? null,
        lateNote: rec?.late_note ?? null,
      }),
      record_id: rec ? Number(rec.id) : null,
      scan_id: scanId,
    };
  });

  const rawQ =
    params.q !== undefined && params.q !== null
      ? String(params.q).trim().toLowerCase()
      : "";

  const filteredStudents = allStudentItems.filter((item) => {
    if (filterStatus && item.status !== filterStatus) {
      return false;
    }
    if (
      rawQ !== "" &&
      !item.name.toLowerCase().includes(rawQ) &&
      !item.nisn.toLowerCase().includes(rawQ)
    ) {
      return false;
    }
    return true;
  });

  return {
    class: {
      id: Number(cls.id),
      name: String(cls.name),
      grade: Number(cls.grade_level),
    },
    date: targetDate,
    counts,
    students: filteredStudents,
  };
}

/**
 * US-43, BR-33 & FSD §5.6 — GET /api/recap/location?date=YYYY-MM-DD
 * Monitoring lokasi GPS siswa di dalam vs di luar radius sekolah pada tanggal tertentu.
 * Memuat attempt terbaru per siswa untuk daftar `outside`.
 */
export async function getRecapLocation(query: { date?: unknown }) {
  await ensureAttendanceAttemptsTable();
  const targetDate = parseAndValidateDate(query.date, "date");

  const [schoolConfig, monitoredRows, outsideAttemptRows] = await Promise.all([
    getSchoolConfig(),
    database
      .execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT ar.student_id) AS monitored_count
         FROM attendance_records ar
         INNER JOIN student_roster sr ON sr.id = ar.student_id
         WHERE sr.is_active = 1
           AND ar.attendance_date = ?
           AND ar.status IN ('hadir', 'terlambat')`,
        [targetDate]
      )
      .then(([rows]) => rows),
    database
      .execute<RowDataPacket[]>(
        `SELECT
           aa.id AS attempt_id,
           aa.student_id,
           aa.distance_m,
           aa.attempted_at,
           aa.latitude,
           aa.longitude,
           sr.nisn,
           sr.full_name AS student_name,
           sr.class_id,
           c.name AS class_name
         FROM attendance_attempts aa
         INNER JOIN student_roster sr ON sr.id = aa.student_id
         LEFT JOIN classes c ON c.id = sr.class_id
         WHERE sr.is_active = 1
           AND aa.outcome = 'rejected_outside_radius'
           AND DATE(aa.attempted_at) = ?
         ORDER BY aa.attempted_at DESC, aa.id DESC`,
        [targetDate]
      )
      .then(([rows]) => rows)
      .catch(() => [] as RowDataPacket[]),
  ]);

  const monitoredStudents = Number(monitoredRows[0]?.monitored_count ?? 0);

  // BR-33: Daftar di luar radius memuat attempt terbaru per siswa
  const seenStudentIds = new Set<number>();
  const outside: Array<{
    attempt_id: number;
    nisn: string;
    name: string;
    class: { id: number; name: string } | null;
    distance_m: number | null;
    attempted_at: string;
    latitude: number | null;
    longitude: number | null;
  }> = [];

  for (const row of outsideAttemptRows) {
    const sid = Number(row.student_id);
    if (seenStudentIds.has(sid)) {
      continue;
    }
    seenStudentIds.add(sid);

    outside.push({
      attempt_id: Number(row.attempt_id),
      nisn: String(row.nisn),
      name: String(row.student_name),
      class:
        row.class_id !== null && row.class_id !== undefined
          ? {
              id: Number(row.class_id),
              name: String(row.class_name ?? `Kelas ${row.class_id}`),
            }
          : null,
      distance_m:
        row.distance_m !== null && row.distance_m !== undefined
          ? Number(row.distance_m)
          : null,
      attempted_at:
        toIsoStringOrNull(row.attempted_at) ?? new Date().toISOString(),
      latitude:
        row.latitude !== null && row.latitude !== undefined
          ? Number(row.latitude)
          : null,
      longitude:
        row.longitude !== null && row.longitude !== undefined
          ? Number(row.longitude)
          : null,
    });
  }

  return {
    date: targetDate,
    center: {
      latitude: schoolConfig.geofence.latitude,
      longitude: schoolConfig.geofence.longitude,
    },
    radius_m: schoolConfig.geofence.radius_m,
    monitored_students: monitoredStudents,
    outside_radius_students: outside.length,
    outside,
  };
}
