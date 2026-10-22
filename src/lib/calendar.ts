import chineseDays from "chinese-days";
import type { Project, Settings } from "../types";

type Overrides = Settings["calendarOverrides"];
export type WorkdayInfo = {
  workday: boolean;
  estimated: boolean;
  label: string;
  lunar: string;
};
export type PeriodPart = {
  label: string;
  start: string;
  end: string;
  workdays: number;
};

export const WEEKDAYS = [
  "星期一（月）",
  "星期二（火）",
  "星期三（水）",
  "星期四（木）",
  "星期五（金）",
  "星期六（土）",
  "星期日（日）",
];
export const HOLIDAY_DATA_RANGE = { startYear: 2004, endYear: 2026 } as const;
export const DATE_RANGE = { min: "1900-01-01", max: "2099-12-31" } as const;
const DAY_MS = 86_400_000;
const lunarCache = new Map<string, string>();

/** ISO date-only values are calendar dates, never local-midnight timestamps. */
function timestamp(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
    throw new RangeError(`无效日期：${iso}`);
  const value = Date.parse(`${iso}T00:00:00.000Z`);
  if (
    !Number.isFinite(value) ||
    new Date(value).toISOString().slice(0, 10) !== iso
  )
    throw new RangeError(`无效日期：${iso}`);
  return value;
}

export function isISODate(value: string): boolean {
  try {
    timestamp(value);
    return true;
  } catch {
    return false;
  }
}

/** Supported persisted/selected dates; neighboring calendar cells may fall outside. */
export function isSupportedDate(value: string): boolean {
  return isISODate(value) && value >= DATE_RANGE.min && value <= DATE_RANGE.max;
}

export function today(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(iso: string, n: number): string {
  if (!Number.isInteger(n)) throw new RangeError("天数必须为整数");
  return new Date(timestamp(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Signed calendar-day difference: b minus a. */
export function diffDays(a: string, b: string): number {
  return (timestamp(b) - timestamp(a)) / DAY_MS;
}

export function monday(iso: string): string {
  const weekday = new Date(timestamp(iso)).getUTCDay();
  return addDays(iso, -((weekday + 6) % 7));
}

function dayStatus(
  iso: string,
  overrides: Overrides = {},
): Omit<WorkdayInfo, "lunar"> {
  const time = timestamp(iso);
  const override = overrides[iso];
  if (override)
    return {
      workday: override.workday,
      estimated: false,
      label: override.note || (override.workday ? "手动工作日" : "手动休息日"),
    };
  const year = Number(iso.slice(0, 4));
  const weekday = new Date(time).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  if (
    year < HOLIDAY_DATA_RANGE.startYear ||
    year > HOLIDAY_DATA_RANGE.endYear
  ) {
    return {
      workday: !weekend,
      estimated: true,
      label: weekend ? "预计休息日" : "预计工作日",
    };
  }
  // The package supplies English,Chinese,statutoryDays for holiday records.
  const detail = chineseDays.getDayDetail(iso);
  const holidayName = detail.name.includes(",")
    ? detail.name.split(",")[1]
    : "";
  return {
    workday: detail.work,
    estimated: false,
    label: holidayName
      ? `${holidayName} · ${detail.work ? "补班" : "休"}`
      : detail.work
        ? "工作日"
        : "休息日",
  };
}

function lunarDate(iso: string): string {
  if (lunarCache.has(iso)) return lunarCache.get(iso)!;
  // chinese-days' lunar table starts on 1900-01-31 and ends during 2100.
  // Do not fabricate lunar dates outside its documented 1900–2100 coverage.
  if (iso < "1900-01-31" || iso > "2099-12-31") return "";
  const lunar = chineseDays.getLunarDate(iso);
  const label = `${lunar.isLeap ? "闰" : ""}${lunar.lunarMonCN}${lunar.lunarDayCN}`;
  if (lunarCache.size > 5000) lunarCache.clear();
  lunarCache.set(iso, label);
  return label;
}

export function workdayInfo(
  iso: string,
  overrides: Overrides = {},
): WorkdayInfo {
  return { ...dayStatus(iso, overrides), lunar: lunarDate(iso) };
}

/** Whether any day in this inclusive interval still relies on a weekday estimate. */
export function hasEstimatedWorkdays(
  start: string,
  end: string,
  overrides: Overrides = {},
): boolean {
  const duration = diffDays(start, end);
  if (duration < 0) return false;
  if (
    start >= `${HOLIDAY_DATA_RANGE.startYear}-01-01` &&
    end <= `${HOLIDAY_DATA_RANGE.endYear}-12-31`
  )
    return false;
  for (let index = 0; index <= duration; index++) {
    const date = addDays(start, index);
    const year = Number(date.slice(0, 4));
    if (
      (year < HOLIDAY_DATA_RANGE.startYear ||
        year > HOLIDAY_DATA_RANGE.endYear) &&
      !overrides[date]
    )
      return true;
  }
  return false;
}

/** Includes both boundary dates. A reversed interval contains no workdays. */
export function workdays(
  start: string,
  end: string,
  overrides: Overrides = {},
): number {
  const duration = diffDays(start, end);
  if (duration < 0) return 0;
  let count = 0;
  for (let index = 0; index <= duration; index++)
    if (dayStatus(addDays(start, index), overrides).workday) count++;
  return count;
}

/** Today is excluded; future projects do not count days before their start. */
export function remainingWorkdays(
  end: string,
  reference = today(),
  overrides: Overrides = {},
  start?: string,
): number {
  timestamp(end);
  const tomorrow = addDays(reference, 1);
  if (start) timestamp(start);
  return workdays(start && start > tomorrow ? start : tomorrow, end, overrides);
}

/** Time elapsed on the project's workday calendar, independent of task completion. */
export function projectTimeProgress(
  start: string,
  end: string,
  reference = today(),
  overrides: Overrides = {},
): number {
  timestamp(reference);
  const total = workdays(start, end, overrides);
  if (end < start || reference < start) return 0;
  if (reference >= end) return 100;
  if (!total) return 0;
  const remaining = remainingWorkdays(end, reference, overrides, start);
  return Math.round(((total - remaining) / total) * 1000) / 10;
}

export function formatDate(iso: string, format = "YYYY.MM.DD"): string {
  timestamp(iso);
  return format
    .replace("YYYY", iso.slice(0, 4))
    .replace("MM", iso.slice(5, 7))
    .replace("DD", iso.slice(8, 10));
}

/** Monday-first, two weeks on either side of the center date's week. */
export function calendarWeeks(center: string): string[][] {
  const first = addDays(monday(center), -14);
  return Array.from({ length: 5 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(first, week * 7 + day)),
  );
}

/** Clip project periods to one week before applying the calendar's visible-row limit. */
export function projectWeekSegments(projects: Project[], week: string[]) {
  if (week.length !== 7) throw new RangeError("一周必须包含 7 天");
  const first = week[0],
    last = week[6];
  timestamp(first);
  timestamp(last);
  return [...projects]
    .filter((project) => project.startDate <= last && project.endDate >= first)
    .sort((a, b) => a.order - b.order)
    .map((project) => ({
      project,
      startColumn:
        diffDays(first, project.startDate < first ? first : project.startDate) +
        1,
      endColumn:
        diffDays(first, project.endDate > last ? last : project.endDate) + 2,
      continuesLeft: project.startDate < first,
      continuesRight: project.endDate > last,
    }));
}

/** Actual workdays grouped by calendar week/month; never divide days by 5 or 20. */
export function periodBreakdown(
  start: string,
  end: string,
  overrides: Overrides = {},
): { byWeek: PeriodPart[]; byMonth: PeriodPart[] } {
  const duration = diffDays(start, end);
  if (duration < 0) return { byWeek: [], byMonth: [] };
  const weeks = new Map<string, PeriodPart>();
  const months = new Map<string, PeriodPart>();
  for (let index = 0; index <= duration; index++) {
    const date = addDays(start, index);
    const week = monday(date);
    const month = date.slice(0, 7);
    if (!weeks.has(week))
      weeks.set(week, {
        label: `${formatDate(week)} — ${formatDate(addDays(week, 6))}`,
        start: date,
        end: date,
        workdays: 0,
      });
    if (!months.has(month))
      months.set(month, {
        label: `${month.slice(0, 4)}年${Number(month.slice(5))}月`,
        start: date,
        end: date,
        workdays: 0,
      });
    const count = dayStatus(date, overrides).workday ? 1 : 0;
    for (const part of [weeks.get(week)!, months.get(month)!]) {
      part.end = date;
      part.workdays += count;
    }
  }
  return { byWeek: [...weeks.values()], byMonth: [...months.values()] };
}
