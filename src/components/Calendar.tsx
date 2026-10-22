import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Diamond, CalendarDays } from "lucide-react";
import { useApp } from "../store";
import {
  today,
  addDays,
  calendarWeeks,
  workdayInfo,
  WEEKDAYS,
  isSupportedDate,
  projectWeekSegments,
  HOLIDAY_DATA_RANGE,
  DATE_RANGE,
} from "../lib/calendar";
import type { Project, Task, Milestone } from "../types";

export default function Calendar({
  projects,
  tasks,
  milestones,
  selectedDate,
  onSelect,
  compact = false,
}: {
  projects: Project[];
  tasks: Task[];
  milestones: Milestone[];
  selectedDate: string;
  onSelect: (date: string) => void;
  compact?: boolean;
}) {
  const { state, act } = useApp();
  const now = today();
  const [center, setCenter] = useState(
    isSupportedDate(selectedDate) ? selectedDate : now,
  );
  const centerRef = useRef(center);
  const selectionRef = useRef(selectedDate);
  centerRef.current = center;
  selectionRef.current = selectedDate;
  const [expanded, setExpanded] = useState(false);
  const weeks = calendarWeeks(center);
  const heat = state.settings.calendarHeatmap;
  const limit = compact ? 2 : 4;
  const segments = weeks.map((week) => projectWeekSegments(projects, week));
  const hasOverflow = segments.some((rows) => rows.length > limit);
  const unknown = weeks
    .flat()
    .some(
      (date) => workdayInfo(date, state.settings.calendarOverrides).estimated,
    );

  // Clicking a visible date keeps the viewport still. External/back navigation to
  // a date outside this viewport reveals that date instead of leaving it hidden.
  useEffect(() => {
    if (!isSupportedDate(selectedDate)) return;
    const displayed = calendarWeeks(center).flat();
    if (
      selectedDate < displayed[0] ||
      selectedDate > displayed[displayed.length - 1]
    )
      setCenter(selectedDate);
  }, [selectedDate]);

  function jump(date: string) {
    if (!isSupportedDate(date)) return;
    // Some date inputs emit both input and change for one edit. Commit once.
    if (centerRef.current === date && selectionRef.current === date) return;
    centerRef.current = date;
    selectionRef.current = date;
    setCenter(date);
    onSelect(date);
  }

  function shiftWeek(offset: number) {
    const next = addDays(center, offset);
    jump(
      next < DATE_RANGE.min
        ? DATE_RANGE.min
        : next > DATE_RANGE.max
          ? DATE_RANGE.max
          : next,
    );
  }

  return (
    <section className={`calendar-panel heat-${heat} ${compact ? "compact" : ""}`}>
      <div className="calendar-toolbar">
        <div>
          <h3>
            {center.slice(0, 4)} <span>/ {center.slice(5, 7)}月</span>
          </h3>
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-btn"
            aria-label="上一周"
            disabled={center <= DATE_RANGE.min}
            onClick={() => shiftWeek(-7)}
          >
            <ChevronLeft size={17} />
          </button>
          <button className="btn small" onClick={() => jump(now)}>
            今天
          </button>
          <button
            className="icon-btn"
            aria-label="下一周"
            disabled={center >= DATE_RANGE.max}
            onClick={() => shiftWeek(7)}
          >
            <ChevronRight size={17} />
          </button>
          <input
            aria-label="跳转日期"
            className="jump-date"
            type="date"
            min={DATE_RANGE.min}
            max={DATE_RANGE.max}
            value={center}
            onInput={(event) => jump(event.currentTarget.value)}
            onChange={(event) => jump(event.target.value)}
          />
        </div>
      </div>
      <div className="calendar-options">
        <div className="segmented" aria-label="日历颜色模式">
          {(
            [
              ["off", "日程"],
              ["rate", "完成率"],
              ["count", "完成数量"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={heat === key}
              className={heat === key ? "active" : ""}
              onClick={() =>
                act("settings.update", { calendarHeatmap: key }).catch(() => {})
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span className="calendar-key">
          <i className="diamond" />
          里程碑 <i className="today-key" />
          今天
        </span>
      </div>
      <div className="weekday-row">
        {WEEKDAYS.map((day, index) => (
          <span key={day} className={index > 4 ? "weekend-head" : ""}>
            {compact ? day.replace("星期", "周") : day}
          </span>
        ))}
      </div>
      <div className="calendar-weeks">
        {weeks.map((week, weekIndex) => {
          const active = expanded
            ? segments[weekIndex]
            : segments[weekIndex].slice(0, limit);
          return (
            <div
              className="calendar-week"
              key={week[0]}
              style={{ "--lanes": Math.max(1, active.length) } as CSSProperties}
            >
              <div className="week-days">
                {week.map((day) => {
                  const rows = tasks.filter((task) => task.date === day);
                  const done = rows.filter((task) => task.done).length;
                  const rate = rows.length
                    ? Math.round((done / rows.length) * 100)
                    : 100;
                  const dayMilestones = milestones.filter(
                    (milestone) => milestone.date === day,
                  );
                  const info = workdayInfo(
                    day,
                    state.settings.calendarOverrides,
                  );
                  const intensity =
                    heat === "off"
                      ? 0
                      : heat === "rate"
                        ? rate / 100
                        : Math.min(1, done / 8);
                  const label = info.estimated
                    ? info.workday
                      ? "预计班"
                      : "预计休"
                    : info.label === "工作日"
                      ? ""
                      : info.label === "休息日"
                        ? "休"
                        : info.label;
                  return (
                    <button
                      aria-label={`${day} ${info.lunar} ${info.label} ${rows.length ? `${rows.length}项任务 ${done}项完成` : "无安排"}${dayMilestones.length ? " " + dayMilestones.map((item) => item.title).join("、") : ""}`}
                      title={`${info.label} · ${rate}% · ${done}/${rows.length}${!rows.length ? " · 无安排" : ""}`}
                      key={day}
                      disabled={!isSupportedDate(day)}
                      onClick={() => onSelect(day)}
                      className={`day-cell ${day === now ? "today" : ""} ${day === selectedDate ? "selected" : ""} ${!info.workday ? "rest-day" : ""} ${day.slice(0, 7) !== center.slice(0, 7) ? "other-month" : ""}`}
                      style={{ "--heat": intensity } as CSSProperties}
                    >
                      <div className="day-number">
                        <strong>{Number(day.slice(8))}</strong>
                        {day === now ? (
                          <b className="today-label">今</b>
                        ) : (
                          label && (
                            <small
                              className={
                                info.workday ? "work-label" : "rest-label"
                              }
                            >
                              {label}
                            </small>
                          )
                        )}
                      </div>
                      <span className="lunar">{info.lunar}</span>
                      <div className="day-milestones">
                        {dayMilestones.map((milestone) => (
                          <span
                            key={milestone.id}
                            className={milestone.done ? "done" : ""}
                            title={milestone.title}
                          >
                            <Diamond size={9} fill="currentColor" />
                            {!compact && <em>{milestone.title}</em>}
                          </span>
                        ))}
                      </div>
                      <div className="day-count">
                        <span>{rate}%</span>
                        <small>
                          {done}/{rows.length}
                          {!rows.length && !compact ? " · 无安排" : ""}
                        </small>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="project-lanes" aria-hidden="true">
                {active.map((segment) => (
                  <div className="project-lane" key={segment.project.id}>
                    <div
                      style={
                        {
                          gridColumn: `${segment.startColumn} / ${segment.endColumn}`,
                          "--project-color": segment.project.color,
                        } as CSSProperties
                      }
                      className={`project-band ${segment.continuesLeft ? "continues-left" : ""} ${segment.continuesRight ? "continues-right" : ""}`}
                    >
                      <span>{segment.project.title}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="calendar-foot">
        {heat === "count" ? (
          <>
            <span>完成数量</span>
            <span className="heat-scale">
              少 <i />
              <i />
              <i />
              <i /> 多 · 最高档 ≥8
            </span>
          </>
        ) : heat === "rate" ? (
          <>
            <span>完成率 · 无安排记作100%</span>
            <span className="heat-scale">
              0% <i />
              <i />
              <i />
              <i /> 100%
            </span>
          </>
        ) : (
          <span>
            <CalendarDays size={12} /> 色带表示项目周期，任务数表示每日安排
          </span>
        )}
        {hasOverflow && (
          <button
            className="text-link"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? "收起项目色带" : "展开全部项目色带"}
          </button>
        )}
      </div>
      {unknown && (
        <p className="calendar-warning">
          部分日期超出内置节假日数据范围（至 {HOLIDAY_DATA_RANGE.endYear}{" "}
          年），工作日按周一至周五预计；可在系统配置中手动确认。
        </p>
      )}
    </section>
  );
}
