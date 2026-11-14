import { RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";
import { buildMonthlyAttendancePdfBuffer } from "../utils/pdf-builder";
import {
  getDayOfWeekIso,
  nowUtc,
  parseMonthRange,
  toWibDate,
  toWibMonth,
  wibTimeOfDay,
} from "../utils/wib-time";
import { buildXlsxBuffer, XlsxSheetInput } from "../utils/xlsx-builder";
import { recordAuditLog } from "./audit.service";
import { getStudentMonthlyAttendanceCalendar } from "./calendar.service";
import { parseAndValidateDateRange } from "./dashboard-recap.service";
import { getAllAttendanceSchedules, getSchoolConfig } from "./school.service";

const STATUS_LABELS_UI: Record<string, string> = {
  hadir: "Hadir",
  terlambat: "Terlambat",
  izin: "Izin",
  sakit: "Sakit",
  alpa: "Alpa",
  belum_hadir: "Belum Hadir",
};

const LATE_REASON_LABELS: Record<string, string> = {
  macet: "Macet Lalu Lintas",
  kendala_kendaraan: "Kendala Kendaraan",
  keperluan_keluarga: "Keperluan Keluarga",
  lainnya: "Lainnya",
};

function formatWibTimeHm(val: Date | string | null | undefined): string {
  if (!val) {
    return "-";
  }
  if (typeof val === "string") {
    // Jika string berformat "YYYY-MM-DD HH:mm:ss" (sudah waktu WIB di DB)
    const matchSql = /^\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2})/.exec(val.trim());
    if (matchSql) {
      return `${matchSql[1]} WIB`;
    }
    const parsed = new Date(val);
    if (!Number.isNaN(parsed.getTime())) {
      return `${wibTimeOfDay(parsed).slice(0, 5)} WIB`;
    }
    return val;
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return `${wibTimeOfDay(val).slice(0, 5)} WIB`;
  }
  return "-";
}

function formatNoteForExport(row: {
  status: string;
  late_minutes?: number | null;
  late_reason?: string | null;
  late_note?: string | null;
}): string {
  const status = row.status;
  if (status === "hadir") {
    return "Tepat Waktu";
  }
  if (status === "terlambat") {
    const mins =
      row.late_minutes !== null &&
      row.late_minutes !== undefined &&
      row.late_minutes > 0
        ? ` (${row.late_minutes} menit)`
        : "";
    const reasonLabel = row.late_reason
      ? (LATE_REASON_LABELS[row.late_reason] ?? row.late_reason)
      : "";
    const extra =
      row.late_note && row.late_note.trim() !== ""
        ? reasonLabel
          ? `${reasonLabel}: ${row.late_note.trim()}`
          : row.late_note.trim()
        : reasonLabel;
    return extra ? `Terlambat${mins} - ${extra}` : `Terlambat${mins}`;
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
  return "-";
}

async function countSchoolDaysInRange(dates: string[]): Promise<number> {
  if (dates.length === 0) {
    return 0;
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

  let count = 0;
  for (const d of dates) {
    const isoDay = getDayOfWeekIso(d);
    const isSchoolDay = scheduleByDay.get(isoDay) ?? isoDay <= 6;
    if (!isSchoolDay) continue;
    const isHoliday = holidayRows.some((h) => {
      const start = String(h.start_date);
      const end = String(h.end_date ?? h.start_date);
      return d >= start && d <= end;
    });
    if (!isHoliday) {
      count += 1;
    }
  }
  return count;
}

interface ClassRow extends RowDataPacket {
  id: number;
  name: string;
  grade_level: number;
}

interface StudentRow extends RowDataPacket {
  id: number;
  nisn: string;
  full_name: string;
  class_id: number | null;
  attendance_number: number | null;
}

interface AttendanceRecordRow extends RowDataPacket {
  id: number;
  student_id: number;
  attendance_date: string;
  status: "hadir" | "terlambat" | "izin" | "sakit" | "alpa";
  check_in_at: Date | string | null;
  late_minutes: number | null;
  late_reason: string | null;
  late_note: string | null;
}

/**
 * US-44, D-14, FSD §5.6 & §7 — GET /api/reports/attendance/export
 * Mengekspor laporan rekap presensi kelas dalam format `.xlsx` (satu hari atau rentang tanggal)
 * dan mencatat aksi `report.attendance.export` ke `audit_logs`.
 */
export async function exportAttendanceReport(params: {
  actorUserId: number;
  ip?: string | null;
  query: {
    format?: unknown;
    from?: unknown;
    to?: unknown;
    date?: unknown;
    class_id?: unknown;
  };
}) {
  const { query } = params;
  const rawFormat =
    query.format !== undefined &&
    query.format !== null &&
    String(query.format).trim() !== ""
      ? String(query.format).trim().toLowerCase()
      : "xlsx";

  if (rawFormat !== "xlsx" && rawFormat !== "json") {
    throw new AppError(
      "Format ekspor tidak didukung. Gunakan format=xlsx.",
      400,
      {
        code: "VALIDATION_ERROR",
        errors: { format: "Format laporan yang didukung adalah xlsx." },
      }
    );
  }

  let filterClassId: number | null = null;
  if (
    query.class_id !== undefined &&
    query.class_id !== null &&
    String(query.class_id).trim() !== ""
  ) {
    const parsed = Number(String(query.class_id).trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new AppError("Filter class_id tidak valid.", 400, {
        code: "VALIDATION_ERROR",
        errors: { class_id: "class_id harus berupa bilangan bulat positif." },
      });
    }
    filterClassId = parsed;
  }

  const range = parseAndValidateDateRange(
    query.from ?? query.date,
    query.to ?? query.date
  );
  const isSingleDay = range.from === range.to;

  const classSql =
    filterClassId !== null
      ? `SELECT id, name, grade_level FROM classes WHERE id = ? ORDER BY grade_level ASC, name ASC`
      : `SELECT id, name, grade_level FROM classes ORDER BY grade_level ASC, name ASC, id ASC`;
  const classParams = filterClassId !== null ? [filterClassId] : [];

  const studentSql =
    filterClassId !== null
      ? `SELECT id, nisn, full_name, class_id, attendance_number
         FROM student_roster
         WHERE is_active = 1 AND class_id = ?
         ORDER BY COALESCE(attendance_number, 999999) ASC, full_name ASC, id ASC`
      : `SELECT id, nisn, full_name, class_id, attendance_number
         FROM student_roster
         WHERE is_active = 1
         ORDER BY COALESCE(attendance_number, 999999) ASC, full_name ASC, id ASC`;

  const [classRows, studentRows, recordRows, schoolDaysCount] =
    await Promise.all([
      database
        .execute<ClassRow[]>(classSql, classParams)
        .then(([rows]) => rows),
      database
        .execute<StudentRow[]>(studentSql, classParams)
        .then(([rows]) => rows),
      database
        .execute<AttendanceRecordRow[]>(
          `SELECT
             ar.id,
             ar.student_id,
             DATE_FORMAT(ar.attendance_date, '%Y-%m-%d') AS attendance_date,
             ar.status,
             ar.check_in_at,
             ar.late_minutes,
             ar.late_reason,
             ar.late_note
           FROM attendance_records ar
           INNER JOIN student_roster sr ON sr.id = ar.student_id
           WHERE sr.is_active = 1
             AND ar.attendance_date >= ?
             AND ar.attendance_date <= ?`,
          [range.from, range.to]
        )
        .then(([rows]) => rows),
      countSchoolDaysInRange(range.dates),
    ]);

  if (classRows.length === 0 || studentRows.length === 0) {
    throw new AppError(
      "Tidak ada data presensi untuk diekspor pada filter yang dipilih.",
      422,
      { code: "NO_DATA" }
    );
  }

  const studentsByClassId = new Map<number, StudentRow[]>();
  for (const st of studentRows) {
    const cid = st.class_id !== null ? Number(st.class_id) : 0;
    const list = studentsByClassId.get(cid) ?? [];
    list.push(st);
    studentsByClassId.set(cid, list);
  }

  const recordsByStudentId = new Map<number, AttendanceRecordRow[]>();
  for (const r of recordRows) {
    const sid = Number(r.student_id);
    const list = recordsByStudentId.get(sid) ?? [];
    list.push(r);
    recordsByStudentId.set(sid, list);
  }

  const sheets: XlsxSheetInput[] = [];
  const effectiveSchoolDays = Math.max(1, schoolDaysCount);

  for (const cls of classRows) {
    const classId = Number(cls.id);
    const classStudents = studentsByClassId.get(classId) ?? [];
    if (classStudents.length === 0) {
      continue;
    }

    const rows: Array<Array<string | number | null>> = [];

    if (isSingleDay) {
      // FSD §5.6: Satu hari -> kolom: No, NISN, Nama Siswa, Status, Waktu Presensi, Keterangan
      rows.push([
        "No",
        "NISN",
        "Nama Siswa",
        "Status",
        "Waktu Presensi",
        "Keterangan",
      ]);

      let totalHadir = 0;
      let totalAlpa = 0;

      classStudents.forEach((st, idx) => {
        const sid = Number(st.id);
        const rec = (recordsByStudentId.get(sid) ?? [])[0] ?? null;
        const statusKey = rec ? rec.status : "belum_hadir";
        const statusLabel = STATUS_LABELS_UI[statusKey] ?? statusKey;

        if (statusKey === "hadir" || statusKey === "terlambat") {
          totalHadir += 1;
        } else if (statusKey === "alpa") {
          totalAlpa += 1;
        }

        const timeStr = rec ? formatWibTimeHm(rec.check_in_at) : "-";
        const noteStr = rec
          ? formatNoteForExport(rec)
          : "Tanpa Keterangan";

        rows.push([
          st.attendance_number ?? idx + 1,
          String(st.nisn),
          String(st.full_name),
          statusLabel,
          timeStr,
          noteStr,
        ]);
      });

      const totalStudents = classStudents.length;
      const attendancePercent =
        totalStudents > 0
          ? Math.round((totalHadir / totalStudents) * 100)
          : 0;

      rows.push([]);
      rows.push(["Total Siswa", totalStudents]);
      rows.push(["Total Hadir", totalHadir]);
      rows.push(["Total Alpa", totalAlpa]);
      rows.push(["Persentase Hadir", `${attendancePercent}%`]);
    } else {
      // FSD §5.6: Rentang -> kolom: No, NISN, Nama Siswa, Hadir, Terlambat, Izin, Sakit, Alpa, % Hadir
      rows.push([
        "No",
        "NISN",
        "Nama Siswa",
        "Hadir",
        "Terlambat",
        "Izin",
        "Sakit",
        "Alpa",
        "% Hadir",
      ]);

      let classHadirSum = 0;
      let classTerlambatSum = 0;
      let classAlpaSum = 0;

      classStudents.forEach((st, idx) => {
        const sid = Number(st.id);
        const stRecords = recordsByStudentId.get(sid) ?? [];
        let hadir = 0;
        let terlambat = 0;
        let izin = 0;
        let sakit = 0;
        let alpa = 0;

        for (const r of stRecords) {
          if (r.status === "hadir") hadir += 1;
          else if (r.status === "terlambat") terlambat += 1;
          else if (r.status === "izin") izin += 1;
          else if (r.status === "sakit") sakit += 1;
          else if (r.status === "alpa") alpa += 1;
        }

        classHadirSum += hadir;
        classTerlambatSum += terlambat;
        classAlpaSum += alpa;

        const pct = Math.min(
          100,
          Math.round(((hadir + terlambat) / effectiveSchoolDays) * 100)
        );

        rows.push([
          st.attendance_number ?? idx + 1,
          String(st.nisn),
          String(st.full_name),
          hadir,
          terlambat,
          izin,
          sakit,
          alpa,
          `${pct}%`,
        ]);
      });

      const totalStudents = classStudents.length;
      const classDenominator = totalStudents * effectiveSchoolDays;
      const classPercent =
        classDenominator > 0
          ? Math.min(
              100,
              Math.round(
                ((classHadirSum + classTerlambatSum) / classDenominator) * 100
              )
            )
          : 0;

      rows.push([]);
      rows.push(["Total Siswa", totalStudents]);
      rows.push(["Total Hadir", classHadirSum + classTerlambatSum]);
      rows.push(["Total Alpa", classAlpaSum]);
      rows.push(["Persentase Hadir", `${classPercent}%`]);
    }

    sheets.push({
      name: String(cls.name),
      rows,
    });
  }

  if (sheets.length === 0) {
    throw new AppError(
      "Tidak ada data siswa aktif pada kelas yang dipilih.",
      422,
      { code: "NO_DATA" }
    );
  }

  const filename = isSingleDay
    ? `Rekap-Presensi-${range.from}.xlsx`
    : `Rekap-Presensi-${range.from}-sd-${range.to}.xlsx`;

  // FSD §7: Catat audit log `report.attendance.export`
  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: "report.attendance.export",
    entity: "attendance_records",
    entityId: filterClassId ? String(filterClassId) : "all",
    meta: {
      format: "xlsx",
      from: range.from,
      to: range.to,
      class_id: filterClassId,
      sheets_count: sheets.length,
    },
    ip: params.ip ?? null,
  });

  const buffer = buildXlsxBuffer(sheets);

  return {
    filename,
    buffer,
    from: range.from,
    to: range.to,
    class_id: filterClassId,
    sheets,
  };
}

/**
 * US-31 & FSD §5.4 — GET /api/me/reports/monthly?month=YYYY-MM
 * Menghasilkan file PDF laporan kehadiran bulanan milik siswa pemanggil.
 */
export async function generateStudentMonthlyReportPdf(params: {
  rosterId: number;
  studentClassId?: number | null;
  month?: unknown;
}) {
  const currentWibMonth = toWibMonth(nowUtc());
  const rawMonth =
    params.month !== undefined &&
    params.month !== null &&
    String(params.month).trim() !== ""
      ? String(params.month).trim()
      : currentWibMonth;

  const parsedMonth = parseMonthRange(rawMonth);
  if (!parsedMonth) {
    throw new AppError("Format bulan tidak valid. Gunakan format YYYY-MM.", 400, {
      code: "VALIDATION_ERROR",
      errors: { month: "Format bulan harus YYYY-MM (contoh: 2026-10)." },
    });
  }

  if (parsedMonth.month > currentWibMonth) {
    throw new AppError(
      "Laporan kehadiran bulanan belum tersedia untuk bulan di masa mendatang.",
      422,
      { code: "MONTH_IN_FUTURE" }
    );
  }

  const [rosterRows, schoolConfig, monthlyCalendar] = await Promise.all([
    database
      .execute<RowDataPacket[]>(
        `SELECT
           sr.id,
           sr.nisn,
           sr.full_name,
           sr.attendance_number,
           sr.class_id,
           c.name AS class_name
         FROM student_roster sr
         LEFT JOIN classes c ON c.id = sr.class_id
         WHERE sr.id = ?
         LIMIT 1`,
        [params.rosterId]
      )
      .then(([rows]) => rows),
    getSchoolConfig(),
    getStudentMonthlyAttendanceCalendar({
      rosterId: params.rosterId,
      studentClassId: params.studentClassId,
      month: parsedMonth.month,
    }),
  ]);

  if (rosterRows.length === 0) {
    throw new AppError("Data profil roster siswa tidak ditemukan.", 404, {
      code: "ROSTER_NOT_FOUND",
    });
  }

  const st = rosterRows[0];
  const nisn = String(st.nisn);
  const studentName = String(st.full_name);
  const className = st.class_name
    ? String(st.class_name)
    : st.class_id
      ? `Kelas ${st.class_id}`
      : "-";
  const absenceNumber =
    st.attendance_number !== null && st.attendance_number !== undefined
      ? Number(st.attendance_number)
      : null;

  const now = nowUtc();
  const generatedAtWib = `${toWibDate(now)} ${wibTimeOfDay(now)}`;

  const reportDays = monthlyCalendar.days.map((d) => ({
    date: d.date,
    status: STATUS_LABELS_UI[d.status] ?? d.status,
    checkInTimeWib: d.check_in_at ? formatWibTimeHm(d.check_in_at) : null,
    note: d.note,
  }));

  const sheetRows: Array<Array<string | number | null>> = [
    [`LAPORAN KEHADIRAN BULANAN SISWA - ${schoolConfig.school_name.toUpperCase()}`],
    ["Periode Bulan", parsedMonth.month, "Dicetak Pada", `${generatedAtWib} WIB`],
    [],
    ["IDENTITAS SISWA"],
    ["NISN", nisn],
    ["Nama Siswa", studentName],
    ["Kelas", className],
    ["No. Absen", absenceNumber ?? "-"],
    [],
    ["RINGKASAN KEHADIRAN BULANAN"],
    ["Hadir", monthlyCalendar.summary.hadir],
    ["Terlambat", monthlyCalendar.summary.terlambat],
    ["Izin", monthlyCalendar.summary.izin],
    ["Sakit", monthlyCalendar.summary.sakit],
    ["Alpa", monthlyCalendar.summary.alpa],
    ["Hari Sekolah Berjalan", monthlyCalendar.summary.school_days],
    ["Persentase Kehadiran", `${monthlyCalendar.summary.attendance_percent}%`],
    [],
    ["No", "Tanggal", "Status", "Jam Masuk", "Keterangan"],
  ];

  reportDays.forEach((d, idx) => {
    sheetRows.push([
      idx + 1,
      d.date,
      d.status,
      d.checkInTimeWib ?? "-",
      d.note ?? "-",
    ]);
  });

  const sheets: XlsxSheetInput[] = [
    {
      name: `Presensi ${parsedMonth.month}`,
      rows: sheetRows,
    },
  ];

  const xlsxBuffer = buildXlsxBuffer(sheets);
  const filename = `Laporan-Presensi-${nisn}-${parsedMonth.month}.xlsx`;

  return {
    filename,
    buffer: xlsxBuffer,
    month: parsedMonth.month,
    student: {
      nisn,
      name: studentName,
      class_name: className,
      absence_number: absenceNumber,
    },
    summary: monthlyCalendar.summary,
    days: reportDays,
    sheets,
  };
}
