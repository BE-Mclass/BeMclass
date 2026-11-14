const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

let customNowUtc: (() => Date) | null = null;

/**
 * Overrides `nowUtc()` for deterministic tests. Pass `null` to restore real clock.
 */
export function setNowUtcForTesting(fn: (() => Date) | null): void {
  customNowUtc = fn;
}

/**
 * Returns the current UTC instant (injectable for testing).
 */
export function nowUtc(): Date {
  return customNowUtc ? customNowUtc() : new Date();
}

/**
 * Formats a UTC instant into a WIB calendar date string `YYYY-MM-DD` (Asia/Jakarta, UTC+7).
 */
export function toWibDate(instant: Date = nowUtc()): string {
  const wibTime = new Date(instant.getTime() + WIB_OFFSET_MS);
  return wibTime.toISOString().slice(0, 10);
}

/**
 * Formats a UTC instant into a WIB current month string `YYYY-MM`.
 */
export function toWibMonth(instant: Date = nowUtc()): string {
  return toWibDate(instant).slice(0, 7);
}

/**
 * Formats a UTC instant into WIB time of day `HH:mm:ss`.
 */
export function wibTimeOfDay(instant: Date = nowUtc()): string {
  const wibTime = new Date(instant.getTime() + WIB_OFFSET_MS);
  return wibTime.toISOString().slice(11, 19);
}

/**
 * Validates `YYYY-MM` format and returns `{ year, month, firstDate, lastDate }`.
 */
export function parseMonthRange(monthStr: string): {
  month: string;
  year: number;
  monthIndex: number; // 1..12
  firstDate: string;
  lastDate: string;
  daysInMonth: number;
} | null {
  if (!/^\d{4}-\d{2}$/.test(monthStr)) {
    return null;
  }
  const [yearPart, monthPart] = monthStr.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart);
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(monthIndex) ||
    monthIndex < 1 ||
    monthIndex > 12
  ) {
    return null;
  }

  // Day 0 of next month gives the number of days in monthIndex
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const paddedMonth = String(monthIndex).padStart(2, "0");
  const firstDate = `${year}-${paddedMonth}-01`;
  const lastDate = `${year}-${paddedMonth}-${String(daysInMonth).padStart(2, "0")}`;

  return {
    month: `${year}-${paddedMonth}`,
    year,
    monthIndex,
    firstDate,
    lastDate,
    daysInMonth,
  };
}

/**
 * Returns ISO day of week: 1 = Monday ... 7 = Sunday for a `YYYY-MM-DD` string.
 */
export function getDayOfWeekIso(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  return utcDay === 0 ? 7 : utcDay;
}

/**
 * Returns the Monday..Sunday date range (`YYYY-MM-DD`) of the week containing `dateStr`.
 */
export function getWibWeekBounds(dateStr: string): {
  weekStart: string;
  weekEnd: string;
} {
  const [y, m, d] = dateStr.split("-").map(Number);
  const currentUtc = new Date(Date.UTC(y, m - 1, d));
  const isoDay = getDayOfWeekIso(dateStr); // 1 (Mon) .. 7 (Sun)

  const mondayUtc = new Date(
    currentUtc.getTime() - (isoDay - 1) * 24 * 60 * 60 * 1000
  );
  const sundayUtc = new Date(
    mondayUtc.getTime() + 6 * 24 * 60 * 60 * 1000
  );

  return {
    weekStart: mondayUtc.toISOString().slice(0, 10),
    weekEnd: sundayUtc.toISOString().slice(0, 10),
  };
}

/**
 * Lists all `YYYY-MM-DD` dates in a given month up to an optional `maxDate` (inclusive).
 */
export function listDatesInMonth(
  year: number,
  monthIndex: number,
  daysInMonth: number,
  maxDate?: string
): string[] {
  const paddedMonth = String(monthIndex).padStart(2, "0");
  const dates: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${paddedMonth}-${String(day).padStart(2, "0")}`;
    if (maxDate && dateStr > maxDate) {
      break;
    }
    dates.push(dateStr);
  }
  return dates;
}
