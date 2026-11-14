import { RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { UserRole } from "../types/auth.types";
import { AppError } from "../utils/errors";
import {
  getDayOfWeekIso,
  getWibWeekBounds,
  listDatesInMonth,
  nowUtc,
  parseMonthRange,
  toWibDate,
  toWibMonth,
} from "../utils/wib-time";
import {
  AnnouncementAudience,
  AnnouncementCategory,
  AnnouncementPriority,
  AUDIENCE_TO_FSD,
  CATEGORY_TO_TYPE,
  PRIORITY_TO_FSD,
} from "./announcement.service";

export interface CalendarEventItem {
  id: number;
  type: string;
  category: AnnouncementCategory;
  title: string;
  description: string;
  event_date: string;
  publish_date: string;
  end_date: string | null;
  priority: string;
  priority_code: AnnouncementPriority;
  audience: string;
  target_audience: AnnouncementAudience;
  class_id: number | null;
}

export interface CalendarDayMark {
  day: number;
  date: string;
  is_today: boolean;
  is_weekend: boolean;
  color: "red" | "amber" | "emerald" | null;
  label: string | null;
  events: CalendarEventItem[];
}

export interface CalendarSummaryResult {
  month: string;
  today: string;
  total_agenda: number;
  agenda_penting: {
    total: number;
    this_week: number;
  };
  libur_nasional: number;
  sedang_berlangsung: number;
  events: CalendarEventItem[];
  days: CalendarDayMark[];
}

export interface StudentAttendanceDayItem {
  date: string;
  status: "hadir" | "terlambat" | "izin" | "sakit" | "alpa" | "belum_presensi";
  check_in_at: string | null;
  late_minutes: number | null;
  late_reason: string | null;
  note: string | null;
}

export interface StudentAttendanceCalendarResult {
  month: string;
  today: string;
  summary: {
    hadir: number;
    terlambat: number;
    izin: number;
    sakit: number;
    alpa: number;
    school_days: number;
    attendance_percent: number;
  };
  days: StudentAttendanceDayItem[];
  events: CalendarEventItem[];
  calendar_marks: Array<{
    date: string;
    attendance_status: string | null;
    events: Array<{
      id: number;
      type: string;
      title: string;
      priority: string;
    }>;
    is_holiday: boolean;
    is_school_day: boolean;
  }>;
}

function resolveAndValidateMonth(monthParam?: unknown): {
  month: string;
  year: number;
  monthIndex: number;
  firstDate: string;
  lastDate: string;
  daysInMonth: number;
} {
  const rawMonth =
    typeof monthParam === "string" && monthParam.trim() !== ""
      ? monthParam.trim()
      : toWibMonth(nowUtc());

  const parsed = parseMonthRange(rawMonth);
  if (!parsed) {
    throw new AppError("Format bulan tidak valid. Gunakan format YYYY-MM.", 400, {
      code: "VALIDATION_ERROR",
      errors: { month: "Format bulan harus YYYY-MM (contoh: 2026-11)." },
    });
  }
  return parsed;
}

function mapRowToCalendarEvent(row: RowDataPacket): CalendarEventItem {
  const category = row.category as AnnouncementCategory;
  const priority = row.priority as AnnouncementPriority;
  const targetAudience = row.target_audience as AnnouncementAudience;

  return {
    id: row.id as number,
    type: CATEGORY_TO_TYPE[category] ?? category,
    category,
    title: row.title as string,
    description: (row.description as string) ?? "",
    event_date: row.publish_date as string,
    publish_date: row.publish_date as string,
    end_date: (row.end_date as string | null) ?? null,
    priority: PRIORITY_TO_FSD[priority] ?? priority,
    priority_code: priority,
    audience: AUDIENCE_TO_FSD[targetAudience] ?? targetAudience,
    target_audience: targetAudience,
    class_id: (row.class_id as number | null) ?? null,
  };
}

function buildAudienceVisibilityClause(
  role: UserRole,
  studentClassId?: number | null
): { clause: string; params: Array<string | number> } {
  // BR-40:
  // - Siswa melihat: 'all' ('semua'), 'siswa', dan (jika class_id terisi) kelasnya sendiri.
  // - Admin/guru melihat: 'all' ('semua'), 'guru', 'siswa' (semua kelas). 'wali' tidak ditampilkan (D-13).
  if (role === "siswa") {
    if (studentClassId) {
      return {
        clause:
          " AND target_audience IN ('all', 'siswa') AND (class_id IS NULL OR class_id = ?)",
        params: [studentClassId],
      };
    }
    return {
      clause: " AND target_audience IN ('all', 'siswa') AND class_id IS NULL",
      params: [],
    };
  }

  return {
    clause: " AND target_audience IN ('all', 'guru', 'siswa')",
    params: [],
  };
}

/**
 * US-50 & US-52 — GET /api/calendar/events?month=YYYY-MM
 * Mengambil seluruh agenda/pengumuman aktif pada bulan yang bersinggungan dengan `month`.
 */
export async function getCalendarEvents(params: {
  month?: unknown;
  role: UserRole;
  studentClassId?: number | null;
}): Promise<CalendarEventItem[]> {
  const range = resolveAndValidateMonth(params.month);
  const visibility = buildAudienceVisibilityClause(
    params.role,
    params.studentClassId
  );

  // Sebuah event beririsan dengan bulan M jika:
  // publish_date <= akhir_bulan DAN COALESCE(end_date, publish_date) >= awal_bulan
  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT
       id, category, title, description,
       DATE_FORMAT(publish_date, '%Y-%m-%d') AS publish_date,
       DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
       target_audience, class_id, priority
     FROM announcements
     WHERE status = 'published'
       AND deleted_at IS NULL
       AND publish_date <= ?
       AND COALESCE(end_date, publish_date) >= ?
       ${visibility.clause}
     ORDER BY publish_date ASC, id ASC`,
    [range.lastDate, range.firstDate, ...visibility.params]
  );

  return rows.map(mapRowToCalendarEvent);
}

/**
 * US-50 & BR-42 — GET /api/calendar/summary?month=YYYY-MM
 * Statistik kalender bulanan untuk Web (Admin & Guru):
 * - total_agenda: jumlah pengumuman/agenda yang beririsan dengan bulan M
 * - agenda_penting: priority IN ('important', 'urgent') atau category = 'important' (+ jumlah dalam minggu ini)
 * - libur_nasional: category = 'holiday' (type = 'libur')
 * - sedang_berlangsung: event yang mencakup hari ini (WIB)
 */
export async function getCalendarSummary(params: {
  month?: unknown;
  role: UserRole;
}): Promise<CalendarSummaryResult> {
  const range = resolveAndValidateMonth(params.month);
  const events = await getCalendarEvents({
    month: range.month,
    role: params.role,
  });

  const todayWib = toWibDate(nowUtc());
  const { weekStart, weekEnd } = getWibWeekBounds(todayWib);

  let totalAgenda = 0;
  let importantTotal = 0;
  let importantThisWeek = 0;
  let nationalHolidayTotal = 0;
  let ongoingTotal = 0;

  for (const ev of events) {
    const start = ev.event_date;
    const end = ev.end_date ?? ev.event_date;

    totalAgenda += 1;

    const isImportant =
      ev.category === "important" ||
      ev.priority_code === "important" ||
      ev.priority_code === "urgent";

    if (isImportant) {
      importantTotal += 1;
      // Cek apakah rentang event beririsan dengan minggu berjalan (Senin..Minggu WIB)
      if (start <= weekEnd && end >= weekStart) {
        importantThisWeek += 1;
      }
    }

    if (ev.category === "holiday") {
      nationalHolidayTotal += 1;
    }

    // Sedang berlangsung: mencakup hari ini (WIB)
    if (start <= todayWib && end >= todayWib) {
      ongoingTotal += 1;
    }
  }

  const allDates = listDatesInMonth(
    range.year,
    range.monthIndex,
    range.daysInMonth
  );

  const days: CalendarDayMark[] = allDates.map((dateStr, idx) => {
    const dayNum = idx + 1;
    const isoDay = getDayOfWeekIso(dateStr);
    const dayEvents = events.filter((ev) => {
      const start = ev.event_date;
      const end = ev.end_date ?? ev.event_date;
      return dateStr >= start && dateStr <= end;
    });

    let color: "red" | "amber" | "emerald" | null = null;
    let label: string | null = null;

    if (dayEvents.length > 0) {
      const holidayEv = dayEvents.find((ev) => ev.category === "holiday");
      const importantEv = dayEvents.find(
        (ev) =>
          ev.category === "important" ||
          ev.priority_code === "important" ||
          ev.priority_code === "urgent"
      );
      const primaryEv = holidayEv ?? importantEv ?? dayEvents[0];

      if (holidayEv) {
        color = "red";
      } else if (importantEv) {
        color = "amber";
      } else {
        color = "emerald";
      }
      label = primaryEv.title;
    }

    return {
      day: dayNum,
      date: dateStr,
      is_today: dateStr === todayWib,
      is_weekend: isoDay >= 6,
      color,
      label,
      events: dayEvents,
    };
  });

  return {
    month: range.month,
    today: todayWib,
    total_agenda: totalAgenda,
    agenda_penting: {
      total: importantTotal,
      this_week: importantThisWeek,
    },
    libur_nasional: nationalHolidayTotal,
    sedang_berlangsung: ongoingTotal,
    events,
    days,
  };
}

/**
 * Mengambil konfigurasi jadwal hari sekolah (1=Senin .. 7=Minggu).
 * Jika tabel belum memiliki baris, default Senin-Sabtu = hari sekolah, Minggu = libur.
 */
async function getSchoolDayScheduleMap(): Promise<
  Map<
    number,
    {
      isSchoolDay: boolean;
      checkinOpen: string | null;
      lateAfter: string | null;
      checkinClose: string | null;
    }
  >
> {
  const map = new Map<
    number,
    {
      isSchoolDay: boolean;
      checkinOpen: string | null;
      lateAfter: string | null;
      checkinClose: string | null;
    }
  >();

  // Default fallback
  for (let d = 1; d <= 7; d++) {
    map.set(d, {
      isSchoolDay: d <= 6,
      checkinOpen: d <= 6 ? "06:00" : null,
      lateAfter: d <= 6 ? "07:15" : null,
      checkinClose: d <= 6 ? "12:00" : null,
    });
  }

  try {
    const [rows] = await database.execute<RowDataPacket[]>(
      `SELECT day_of_week, is_school_day,
              TIME_FORMAT(checkin_open, '%H:%i') AS checkin_open,
              TIME_FORMAT(late_after, '%H:%i') AS late_after,
              TIME_FORMAT(checkin_close, '%H:%i') AS checkin_close
       FROM attendance_schedules`
    );
    for (const row of rows) {
      map.set(Number(row.day_of_week), {
        isSchoolDay: Boolean(row.is_school_day),
        checkinOpen: (row.checkin_open as string | null) ?? null,
        lateAfter: (row.late_after as string | null) ?? null,
        checkinClose: (row.checkin_close as string | null) ?? null,
      });
    }
  } catch {
    // Gunakan default jika tabel belum dimigrasi
  }

  return map;
}

function formatAttendanceNote(row: RowDataPacket): string {
  const status = row.status as string;
  if (status === "hadir") {
    return "Tepat Waktu";
  }
  if (status === "terlambat") {
    const lateMins = row.late_minutes ? ` (${row.late_minutes} menit)` : "";
    const reason = row.late_note || row.late_reason || "";
    return reason ? `Terlambat${lateMins} - ${reason}` : `Terlambat${lateMins}`;
  }
  if (status === "izin") {
    return "Izin";
  }
  if (status === "sakit") {
    return "Sakit";
  }
  if (status === "alpa") {
    return "Tanpa Keterangan (Alpa)";
  }
  return "";
}

/**
 * US-30 & US-52 — GET /api/me/attendance?month=YYYY-MM & GET /api/calendar/attendance?month=YYYY-MM
 * Riwayat & kalender presensi bulanan siswa:
 * - Daftar per bulan berisi tanggal, status, jam masuk, keterangan
 * - Ringkasan jumlah per status (hadir, terlambat, izin, sakit, alpa, school_days, attendance_percent)
 * - Menggabungkan agenda kalender & status kehadiran per tanggal untuk tampilan kalender mobile
 */
export async function getStudentMonthlyAttendanceCalendar(params: {
  rosterId: number;
  studentClassId?: number | null;
  month?: unknown;
}): Promise<StudentAttendanceCalendarResult> {
  const range = resolveAndValidateMonth(params.month);
  const todayWib = toWibDate(nowUtc());

  const [scheduleMap, events, recordRows] = await Promise.all([
    getSchoolDayScheduleMap(),
    getCalendarEvents({
      month: range.month,
      role: "siswa",
      studentClassId: params.studentClassId,
    }),
    database
      .execute<RowDataPacket[]>(
        `SELECT
           id,
           DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
           status,
           check_in_at,
           late_minutes,
           late_reason,
           late_note
         FROM attendance_records
         WHERE student_id = ?
           AND attendance_date >= ?
           AND attendance_date <= ?
         ORDER BY attendance_date ASC`,
        [params.rosterId, range.firstDate, range.lastDate]
      )
      .then(([rows]) => rows),
  ]);

  const recordByDate = new Map<string, RowDataPacket>();
  for (const row of recordRows) {
    recordByDate.set(row.attendance_date as string, row);
  }

  // Cek tanggal mana saja di bulan ini yang merupakan hari libur dari pengumuman type='libur' (category='holiday')
  const isHolidayDate = (dateStr: string): boolean => {
    return events.some((ev) => {
      if (ev.category !== "holiday") {
        return false;
      }
      const start = ev.event_date;
      const end = ev.end_date ?? ev.event_date;
      return dateStr >= start && dateStr <= end;
    });
  };

  let hadir = 0;
  let terlambat = 0;
  let izin = 0;
  let sakit = 0;
  let alpa = 0;
  let schoolDaysElapsed = 0;

  const days: StudentAttendanceDayItem[] = [];
  const allMonthDates = listDatesInMonth(
    range.year,
    range.monthIndex,
    range.daysInMonth
  );

  const calendarMarks = allMonthDates.map((dateStr) => {
    const dayOfWeek = getDayOfWeekIso(dateStr);
    const schedule = scheduleMap.get(dayOfWeek);
    const holiday = isHolidayDate(dateStr);
    // BR-10: Hari sekolah = is_school_day pada jadwal DAN tidak ada pengumuman libur
    const isSchoolDay = Boolean(schedule?.isSchoolDay) && !holiday;

    const record = recordByDate.get(dateStr);
    const dayEvents = events
      .filter((ev) => {
        const start = ev.event_date;
        const end = ev.end_date ?? ev.event_date;
        return dateStr >= start && dateStr <= end;
      })
      .map((ev) => ({
        id: ev.id,
        type: ev.type,
        title: ev.title,
        priority: ev.priority,
      }));

    let attendanceStatus: StudentAttendanceDayItem["status"] | null = null;

    if (record) {
      const status = record.status as
        | "hadir"
        | "terlambat"
        | "izin"
        | "sakit"
        | "alpa";
      attendanceStatus = status;

      if (dateStr <= todayWib) {
        if (status === "hadir") hadir += 1;
        else if (status === "terlambat") terlambat += 1;
        else if (status === "izin") izin += 1;
        else if (status === "sakit") sakit += 1;
        else if (status === "alpa") alpa += 1;
      }

      if (isSchoolDay && dateStr <= todayWib) {
        schoolDaysElapsed += 1;
      }

      const checkInAtIso = record.check_in_at
        ? new Date(record.check_in_at).toISOString()
        : null;

      days.push({
        date: dateStr,
        status,
        check_in_at: checkInAtIso,
        late_minutes:
          record.late_minutes !== null && record.late_minutes !== undefined
            ? Number(record.late_minutes)
            : null,
        late_reason: (record.late_reason as string | null) ?? null,
        note: formatAttendanceNote(record),
      });
    } else if (isSchoolDay && dateStr <= todayWib) {
      schoolDaysElapsed += 1;
      if (dateStr === todayWib) {
        attendanceStatus = "belum_presensi";
      }
    }

    return {
      date: dateStr,
      attendance_status: attendanceStatus,
      events: dayEvents,
      is_holiday: holiday,
      is_school_day: isSchoolDay,
    };
  });

  // BR-31: Persentase hadir = (hadir + terlambat) / total_hari_sekolah_berjalan * 100, dibulatkan 0 desimal
  const denominator = Math.max(
    schoolDaysElapsed,
    hadir + terlambat + izin + sakit + alpa
  );
  const attendancePercent =
    denominator > 0 ? Math.round(((hadir + terlambat) / denominator) * 100) : 0;

  return {
    month: range.month,
    today: todayWib,
    summary: {
      hadir,
      terlambat,
      izin,
      sakit,
      alpa,
      school_days: denominator,
      attendance_percent: attendancePercent,
    },
    days,
    events,
    calendar_marks: calendarMarks,
  };
}

/**
 * US-13 — GET /api/me/attendance/today
 * Menampilkan status kehadiran siswa hari ini, jendela waktu presensi, dan info hari sekolah/libur.
 */
export async function getStudentTodayAttendanceStatus(params: {
  rosterId: number;
  studentClassId?: number | null;
}) {
  const todayWib = toWibDate(nowUtc());
  const dayOfWeek = getDayOfWeekIso(todayWib);

  const [scheduleMap, recordRows, holidayRows, faceTemplateRows] = await Promise.all([
    getSchoolDayScheduleMap(),
    database
      .execute<RowDataPacket[]>(
        `SELECT id, status, check_in_at, late_minutes, late_reason, late_note
         FROM attendance_records
         WHERE student_id = ? AND attendance_date = ?
         LIMIT 1`,
        [params.rosterId, todayWib]
      )
      .then(([rows]) => rows),
    database
      .execute<RowDataPacket[]>(
        `SELECT id, title
         FROM announcements
         WHERE status = 'published'
           AND deleted_at IS NULL
           AND category = 'holiday'
           AND publish_date <= ?
           AND COALESCE(end_date, publish_date) >= ?
         ORDER BY publish_date DESC
         LIMIT 1`,
        [todayWib, todayWib]
      )
      .then(([rows]) => rows),
    database
      .execute<RowDataPacket[]>(
        `SELECT id FROM face_templates WHERE student_id = ? AND status = 'active' LIMIT 1`,
        [params.rosterId]
      )
      .then(([rows]) => rows)
      .catch(() => [] as RowDataPacket[]),
  ]);

  const schedule = scheduleMap.get(dayOfWeek);
  const holiday = holidayRows[0] ?? null;
  const isSchoolDay = Boolean(schedule?.isSchoolDay) && !holiday;

  const recordRow = recordRows[0];
  const status = recordRow
    ? (recordRow.status as string)
    : "belum_presensi";

  return {
    date: todayWib,
    is_school_day: isSchoolDay,
    holiday_title: holiday ? (holiday.title as string) : null,
    enrolled: faceTemplateRows.length > 0,
    status,
    record: recordRow
      ? {
          id: recordRow.id as number,
          status: recordRow.status as string,
          check_in_at: recordRow.check_in_at
            ? new Date(recordRow.check_in_at).toISOString()
            : null,
          late_minutes:
            recordRow.late_minutes !== null &&
            recordRow.late_minutes !== undefined
              ? Number(recordRow.late_minutes)
              : null,
          late_reason: (recordRow.late_reason as string | null) ?? null,
          late_note: (recordRow.late_note as string | null) ?? null,
        }
      : null,
    window: {
      open: schedule?.checkinOpen ?? "06:00",
      late_after: schedule?.lateAfter ?? "07:15",
      close: schedule?.checkinClose ?? "12:00",
    },
  };
}
