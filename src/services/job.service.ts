import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";
import {
  getDayOfWeekIso,
  nowUtc,
  toWibDate,
  wibTimeOfDay,
} from "../utils/wib-time";
import {
  getAllAttendanceSchedules,
  getHolidayAnnouncementOnDate,
} from "./school.service";

export type SupportedJobName =
  | "alpa"
  | "alpa-catchup"
  | "cleanup-auth"
  | "cleanup-attempts"
  | (string & {});

export interface JobRunItem {
  id: number;
  job_name: string;
  run_date: string;
  started_at: string;
  finished_at: string | null;
  affected: number | null;
}

export interface JobExecutionResult {
  status: "completed" | "skipped";
  reason?: string;
  job_name: string;
  run_date: string;
  affected: number;
  job_run: JobRunItem | null;
  details?: Record<string, unknown>;
}

export interface ListJobRunsFilters {
  job_name?: unknown;
  from?: unknown;
  to?: unknown;
  page?: unknown;
  limit?: unknown;
}

let jobRunsTableEnsured = false;

/**
 * Ensures the `job_runs` table exists (0 foreign keys — TRD §4.2 & §8).
 */
export async function ensureJobRunsTable(): Promise<void> {
  if (jobRunsTableEnsured) {
    return;
  }
  await database.execute(
    `CREATE TABLE IF NOT EXISTS job_runs (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       job_name VARCHAR(60) NOT NULL,
       run_date DATE NOT NULL,
       started_at DATETIME NOT NULL,
       finished_at DATETIME NULL,
       affected INT UNSIGNED NULL,
       UNIQUE KEY uq_job_date (job_name, run_date)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  jobRunsTableEnsured = true;
}

function mapJobRunRow(row: RowDataPacket): JobRunItem {
  return {
    id: Number(row.id),
    job_name: String(row.job_name),
    run_date: String(row.run_date),
    started_at:
      row.started_at instanceof Date
        ? row.started_at.toISOString()
        : new Date(row.started_at).toISOString(),
    finished_at:
      row.finished_at !== null && row.finished_at !== undefined
        ? row.finished_at instanceof Date
          ? row.finished_at.toISOString()
          : new Date(row.finished_at).toISOString()
        : null,
    affected:
      row.affected !== null && row.affected !== undefined
        ? Number(row.affected)
        : null,
  };
}

function isValidDateYmd(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

function timeHmToMinutes(hm: string): number {
  const parts = hm.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/**
 * Mengambil satu baris `job_runs` berdasarkan `(job_name, run_date)`.
 */
export async function getJobRun(
  jobName: string,
  runDate: string
): Promise<JobRunItem | null> {
  await ensureJobRunsTable();
  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT
       id,
       job_name,
       DATE_FORMAT(run_date, '%Y-%m-%d') AS run_date,
       started_at,
       finished_at,
       affected
     FROM job_runs
     WHERE job_name = ? AND run_date = ?
     LIMIT 1`,
    [jobName, runDate]
  );
  return rows.length > 0 ? mapJobRunRow(rows[0]) : null;
}

/**
 * Pondasi eksekusi job idempoten dengan MySQL Advisory Lock (`GET_LOCK`) dan pencatatan `job_runs` (TRD §8, TD-05).
 */
export async function executeWithJobRunLock(params: {
  jobName: SupportedJobName;
  runDate?: string;
  force?: boolean;
  handler: (runDate: string) => Promise<{
    affected: number;
    details?: Record<string, unknown>;
  }>;
}): Promise<JobExecutionResult> {
  await ensureJobRunsTable();

  const jobName = params.jobName.trim().slice(0, 60);
  const runDate = params.runDate ?? toWibDate(nowUtc());

  if (!isValidDateYmd(runDate)) {
    throw new AppError("Format tanggal eksekusi job tidak valid (gunakan YYYY-MM-DD).", 400, {
      code: "VALIDATION_ERROR",
      errors: { run_date: "Tanggal harus berformat YYYY-MM-DD." },
    });
  }

  // 1. Cek idempotensi: apakah job sudah selesai pada tanggal ini?
  const existing = await getJobRun(jobName, runDate);
  if (existing && existing.finished_at !== null && !params.force) {
    return {
      status: "skipped",
      reason: "ALREADY_COMPLETED",
      job_name: jobName,
      run_date: runDate,
      affected: existing.affected ?? 0,
      job_run: existing,
    };
  }

  const lockKey = `mclass_job_${jobName}`.slice(0, 64);
  let dedicatedConn: PoolConnection | null = null;
  let lockAcquired = false;

  try {
    if (typeof (database as any).getConnection === "function") {
      try {
        dedicatedConn = await database.getConnection();
        const [lockRows] = await dedicatedConn.execute<RowDataPacket[]>(
          `SELECT GET_LOCK(?, 0) AS locked`,
          [lockKey]
        );
        lockAcquired = Number(lockRows[0]?.locked ?? 0) === 1;
        if (!lockAcquired) {
          return {
            status: "skipped",
            reason: "LOCK_HELD_BY_ANOTHER_INSTANCE",
            job_name: jobName,
            run_date: runDate,
            affected: 0,
            job_run: existing,
          };
        }
      } catch {
        // Fallback jika menggunakan mock database di unit test
        dedicatedConn = null;
      }
    }

    // 2. Catat waktu mulai (`started_at`) di `job_runs`
    await database.execute<ResultSetHeader>(
      `INSERT INTO job_runs (job_name, run_date, started_at, finished_at, affected)
       VALUES (?, ?, UTC_TIMESTAMP(), NULL, NULL)
       ON DUPLICATE KEY UPDATE
         started_at = UTC_TIMESTAMP(),
         finished_at = NULL,
         affected = NULL`,
      [jobName, runDate]
    );

    // 3. Jalankan logika bisnis job
    const outcome = await params.handler(runDate);
    const affectedCount = Math.max(0, Math.floor(Number(outcome.affected) || 0));

    // 4. Tandai selesai (`finished_at`) dan simpan jumlah baris terdampak (`affected`)
    await database.execute(
      `UPDATE job_runs
       SET finished_at = UTC_TIMESTAMP(), affected = ?
       WHERE job_name = ? AND run_date = ?`,
      [affectedCount, jobName, runDate]
    );

    const updatedJobRun = await getJobRun(jobName, runDate);

    return {
      status: "completed",
      job_name: jobName,
      run_date: runDate,
      affected: affectedCount,
      job_run: updatedJobRun,
      ...(outcome.details ? { details: outcome.details } : {}),
    };
  } finally {
    if (dedicatedConn) {
      if (lockAcquired) {
        try {
          await dedicatedConn.execute(`SELECT RELEASE_LOCK(?)`, [lockKey]);
        } catch {
          // Abaikan error saat release lock
        }
      }
      dedicatedConn.release();
    }
  }
}

/**
 * Job `alpa` (US-14, BR-28, BR-29, TRD §8):
 * Menandai siswa aktif yang belum memiliki catatan presensi pada hari sekolah sebagai `alpa` (`source='auto_alpa'`).
 */
export async function runAutoAlpaJob(
  targetDate?: string,
  options?: { force?: boolean; bypassTimeCheck?: boolean }
): Promise<JobExecutionResult> {
  const runDate = targetDate ?? toWibDate(nowUtc());
  if (!isValidDateYmd(runDate)) {
    throw new AppError("Format tanggal tidak valid (gunakan YYYY-MM-DD).", 400, {
      code: "VALIDATION_ERROR",
      errors: { run_date: "Tanggal harus berformat YYYY-MM-DD." },
    });
  }

  const dayOfWeek = getDayOfWeekIso(runDate);
  const [schedules, holiday] = await Promise.all([
    getAllAttendanceSchedules(),
    getHolidayAnnouncementOnDate(runDate),
  ]);

  const schedule = schedules.find((s) => s.day_of_week === dayOfWeek);
  const isSchoolDay = Boolean(schedule?.is_school_day) && !holiday;

  // BR-29: Jangan jalankan job alpa pada hari libur / non-sekolah
  if (!isSchoolDay) {
    return {
      status: "skipped",
      reason: holiday ? `HOLIDAY (${holiday.title})` : "NOT_SCHOOL_DAY",
      job_name: "alpa",
      run_date: runDate,
      affected: 0,
      job_run: await getJobRun("alpa", runDate),
    };
  }

  // BR-28: Jika tanggal adalah hari ini (WIB) dan tidak di-bypass, pastikan sudah melewati checkin_close + ALPA_DELAY_MIN
  const todayWib = toWibDate(nowUtc());
  if (runDate === todayWib && !options?.bypassTimeCheck && !options?.force) {
    const closeHm = schedule?.checkin_close ?? "12:00";
    const delayMin = Number(process.env.ALPA_DELAY_MIN ?? 5);
    const cutoffMin = timeHmToMinutes(closeHm) + (Number.isFinite(delayMin) ? delayMin : 5);
    const nowHm = wibTimeOfDay(nowUtc()).slice(0, 5);
    const nowMin = timeHmToMinutes(nowHm);

    if (nowMin < cutoffMin) {
      return {
        status: "skipped",
        reason: "BEFORE_CUTOFF_TIME",
        job_name: "alpa",
        run_date: runDate,
        affected: 0,
        job_run: await getJobRun("alpa", runDate),
        details: {
          current_wib_time: nowHm,
          checkin_close: closeHm,
          alpa_delay_min: delayMin,
        },
      };
    }
  }

  return executeWithJobRunLock({
    jobName: "alpa",
    runDate,
    force: options?.force,
    handler: async (dateStr) => {
      const [result] = await database.execute<ResultSetHeader>(
        `INSERT IGNORE INTO attendance_records (student_id, attendance_date, status, source)
         SELECT sr.id, ?, 'alpa', 'auto_alpa'
         FROM student_roster sr
         LEFT JOIN attendance_records ar
           ON ar.student_id = sr.id AND ar.attendance_date = ?
         WHERE sr.is_active = 1
           AND ar.id IS NULL`,
        [dateStr, dateStr]
      );
      return {
        affected: result.affectedRows ?? 0,
      };
    },
  });
}

/**
 * Job `alpa-catchup` (BR-29, TRD §8):
 * Menjalankan catch-up untuk hari-hari sekolah yang terlewat hingga N hari ke belakang.
 */
export async function runAlpaCatchupJob(options?: {
  daysBack?: number;
  force?: boolean;
}): Promise<JobExecutionResult> {
  const rawDays = Number(options?.daysBack ?? 7);
  const daysBack =
    Number.isSafeInteger(rawDays) && rawDays >= 1 && rawDays <= 30 ? rawDays : 7;
  const todayWib = toWibDate(nowUtc());

  return executeWithJobRunLock({
    jobName: "alpa-catchup",
    runDate: todayWib,
    force: options?.force ?? true,
    handler: async () => {
      const [y, m, d] = todayWib.split("-").map(Number);
      const baseUtc = new Date(Date.UTC(y, m - 1, d));
      let totalAffected = 0;
      const processedDates: Array<{
        date: string;
        status: string;
        affected: number;
      }> = [];

      for (let i = daysBack; i >= 1; i--) {
        const pastUtc = new Date(baseUtc.getTime() - i * 24 * 60 * 60 * 1000);
        const pastDateStr = pastUtc.toISOString().slice(0, 10);
        const res = await runAutoAlpaJob(pastDateStr, {
          bypassTimeCheck: true,
        });
        totalAffected += res.affected;
        processedDates.push({
          date: pastDateStr,
          status: res.status,
          affected: res.affected,
        });
      }

      return {
        affected: totalAffected,
        details: {
          days_checked: daysBack,
          dates: processedDates,
        },
      };
    },
  });
}

/**
 * Job `cleanup-auth` (TRD §8):
 * Menghapus sesi kedaluwarsa & sesi yang telah dicabut lebih dari 7 hari.
 */
export async function runCleanupAuthJob(options?: {
  runDate?: string;
  force?: boolean;
}): Promise<JobExecutionResult> {
  const runDate = options?.runDate ?? toWibDate(nowUtc());

  return executeWithJobRunLock({
    jobName: "cleanup-auth",
    runDate,
    force: options?.force,
    handler: async () => {
      const [result] = await database.execute<ResultSetHeader>(
        `DELETE FROM user_sessions
         WHERE expires_at < UTC_TIMESTAMP()
            OR (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY))`
      );
      return {
        affected: result.affectedRows ?? 0,
      };
    },
  });
}

/**
 * Mengambil riwayat eksekusi job dari tabel `job_runs` (khusus Admin).
 */
export async function listJobRuns(filters?: ListJobRunsFilters): Promise<{
  data: JobRunItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}> {
  await ensureJobRunsTable();

  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (typeof filters?.job_name === "string" && filters.job_name.trim() !== "") {
    whereClauses.push(" AND job_name = ?");
    params.push(filters.job_name.trim());
  }

  if (
    typeof filters?.from === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(filters.from.trim())
  ) {
    whereClauses.push(" AND run_date >= ?");
    params.push(filters.from.trim());
  }

  if (
    typeof filters?.to === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(filters.to.trim())
  ) {
    whereClauses.push(" AND run_date <= ?");
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
    `SELECT COUNT(*) AS total FROM job_runs ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total ?? 0);
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT
       id,
       job_name,
       DATE_FORMAT(run_date, '%Y-%m-%d') AS run_date,
       started_at,
       finished_at,
       affected
     FROM job_runs
     ${whereSql}
     ORDER BY run_date DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(mapJobRunRow),
    meta: {
      page,
      limit,
      total,
      total_pages: totalPages,
    },
  };
}
