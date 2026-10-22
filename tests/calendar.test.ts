import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, diffDays, monday, today, workdayInfo, workdays, remainingWorkdays, projectTimeProgress, calendarWeeks, periodBreakdown, formatDate, WEEKDAYS, isISODate, isSupportedDate, DATE_RANGE, hasEstimatedWorkdays, projectWeekSegments } from '../src/lib/calendar';
import type { Project } from '../src/types';

test('date-only arithmetic preserves leap days, DST boundaries and ISO dates', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(diffDays('2026-03-07', '2026-03-10'), 3);
  assert.equal(diffDays('2026-03-10', '2026-03-07'), -3);
  assert.equal(monday('2026-10-25'), '2026-10-19');
  assert.throws(() => addDays('2026-02-30', 1), RangeError);
  assert.throws(() => workdays('', '2026-10-22'), RangeError);
  assert.equal(formatDate('2026-10-22', 'MM/DD'), '10/22');
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(isISODate('2024-02-29'), true);
});

test('supported selection dates stay within 1900–2099 while boundary weeks render safely', () => {
  assert.equal(isSupportedDate(DATE_RANGE.min), true);
  assert.equal(isSupportedDate(DATE_RANGE.max), true);
  assert.equal(isSupportedDate('1899-12-31'), false);
  assert.equal(isSupportedDate('2100-01-01'), false);
  assert.equal(isSupportedDate('9999-12-31'), false);
  assert.equal(isSupportedDate('1900-02-29'), false);
  for (const boundary of [DATE_RANGE.min, DATE_RANGE.max]) {
    const days = calendarWeeks(boundary).flat();
    assert.equal(days.length, 35);
    assert.ok(days.every(isISODate));
    assert.doesNotThrow(() => days.map(day => workdayInfo(day)));
    assert.ok(days.some(day => !isSupportedDate(day)));
  }
});

test('project-wide estimate warnings include dates outside the visible calendar and respect confirmations', () => {
  assert.equal(hasEstimatedWorkdays('2026-10-22', '2026-12-31'), false);
  assert.equal(hasEstimatedWorkdays('2026-10-22', '2027-02-01'), true);
  assert.equal(hasEstimatedWorkdays('2026-12-31', '2027-01-01', { '2027-01-01': { workday: false, note: '已确认' } }), false);
  assert.equal(hasEstimatedWorkdays('2027-01-01', '2027-01-02', { '2027-01-01': { workday: false, note: '已确认' } }), true);
  assert.equal(hasEstimatedWorkdays('2027-01-02', '2027-01-01'), false);
});

test('weekly project bands exclude unrelated projects before limiting and clip at Monday/Sunday', () => {
  const project = (id: string, order: number, startDate: string, endDate: string) => ({ id, order, startDate, endDate } as Project);
  const projects = [
    project('old-1', 0, '2026-01-01', '2026-01-31'),
    project('old-2', 1, '2026-02-01', '2026-02-28'),
    project('old-3', 2, '2026-03-01', '2026-03-31'),
    project('old-4', 3, '2026-04-01', '2026-04-30'),
    project('through', 4, '2026-10-01', '2026-10-31'),
    project('mid-week', 5, '2026-10-21', '2026-10-23'),
    project('sunday', 6, '2026-10-25', '2026-10-25'),
  ];
  const segments = projectWeekSegments(projects, calendarWeeks('2026-10-22')[2]);
  assert.deepEqual(segments.map(segment => segment.project.id), ['through', 'mid-week', 'sunday']);
  assert.deepEqual(segments.map(({ startColumn, endColumn, continuesLeft, continuesRight }) => ({ startColumn, endColumn, continuesLeft, continuesRight })), [
    { startColumn: 1, endColumn: 8, continuesLeft: true, continuesRight: true },
    { startColumn: 3, endColumn: 6, continuesLeft: false, continuesRight: false },
    { startColumn: 7, endColumn: 8, continuesLeft: false, continuesRight: false },
  ]);
});

test('China 2026 holiday periods and make-up weekend workdays use bundled official data', () => {
  assert.equal(workdayInfo('2026-10-01').workday, false);
  assert.match(workdayInfo('2026-10-01').label, /国庆节/);
  assert.equal(workdayInfo('2026-10-10').workday, true);
  assert.match(workdayInfo('2026-10-10').label, /补班/);
  assert.equal(workdayInfo('2026-01-04').workday, true);
  assert.equal(workdays('2026-10-01', '2026-10-11'), 3);
  assert.equal(workdays('2026-02-15', '2026-02-23'), 0);
  assert.equal(workdayInfo('2026-02-28').workday, true);
});

test('unknown holiday years remain estimates; explicit manual overrides take precedence', () => {
  assert.deepEqual([workdayInfo('2027-01-01').workday, workdayInfo('2027-01-01').estimated], [true, true]);
  assert.deepEqual([workdayInfo('2027-01-02').workday, workdayInfo('2027-01-02').estimated], [false, true]);
  const overrides = { '2027-01-01': { workday: false, note: '本人已确认休假' }, '2026-10-01': { workday: true, note: '值班' } };
  assert.equal(workdayInfo('2027-01-01', overrides).estimated, false);
  assert.equal(workdayInfo('2027-01-01', overrides).workday, false);
  assert.equal(workdayInfo('2026-10-01', overrides).workday, true);
  assert.equal(workdays('2026-10-01', '2026-10-11', overrides), 4);
});

test('remaining workdays exclude today and clamp future projects to their start', () => {
  assert.equal(remainingWorkdays('2026-10-23', '2026-10-22'), 1);
  assert.equal(remainingWorkdays('2026-10-23', '2026-10-23'), 0);
  assert.equal(remainingWorkdays('2026-10-23', '2026-10-24'), 0);
  assert.equal(remainingWorkdays('2026-10-30', '2026-10-01', {}, '2026-10-26'), 5);
  assert.equal(workdays('2026-10-30', '2026-10-26'), 0);
});

test('time progress uses the same workday denominator and stays separate from tasks', () => {
  assert.equal(projectTimeProgress('2026-10-19', '2026-10-23', '2026-10-18'), 0);
  assert.equal(projectTimeProgress('2026-10-19', '2026-10-23', '2026-10-22'), 80);
  assert.equal(projectTimeProgress('2026-10-19', '2026-10-23', '2026-10-23'), 100);
  assert.equal(projectTimeProgress('2026-10-19', '2026-10-23', '2026-11-01'), 100);
  assert.equal(projectTimeProgress('2026-10-01', '2026-10-07', '2026-10-03'), 0);
  assert.equal(projectTimeProgress('2026-10-01', '2026-10-07', '2026-10-07'), 100);
});

test('lunar labels include month and leap-month indicator', () => {
  assert.equal(workdayInfo('2026-02-17').lunar, '正月初一');
  assert.equal(workdayInfo('2025-07-25').lunar, '闰六月初一');
  assert.equal(workdayInfo('2026-10-22').lunar, '九月十三');
});

test('five-week calendar centers selected week and crosses month/year boundaries', () => {
  const weeks = calendarWeeks('2027-01-01');
  assert.equal(weeks.length, 5);
  assert.ok(weeks.every(week => week.length === 7));
  assert.equal(weeks[2][0], '2026-12-28');
  assert.equal(weeks[2][4], '2027-01-01');
  assert.equal(weeks[4][6], '2027-01-17');
  assert.equal(WEEKDAYS[4], '星期五（金）');
});

test('week/month breakdown clips to actual interval and sums exact workdays', () => {
  const start = '2026-09-28', end = '2026-10-11';
  const parts = periodBreakdown(start, end);
  assert.equal(parts.byWeek.length, 2);
  assert.equal(parts.byMonth.length, 2);
  assert.equal(parts.byMonth[0].start, start);
  assert.equal(parts.byMonth[0].end, '2026-09-30');
  assert.equal(parts.byMonth[1].end, end);
  for (const group of [parts.byWeek, parts.byMonth]) assert.equal(group.reduce((sum, part) => sum + part.workdays, 0), workdays(start, end));
  assert.deepEqual(periodBreakdown(end, start), { byWeek: [], byMonth: [] });
});
