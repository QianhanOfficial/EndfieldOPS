import { Diamond, Flag } from "lucide-react";
import { useApp } from "../store";
import {
  today,
  addDays,
  workdays,
  remainingWorkdays,
  projectTimeProgress,
  formatDate,
  hasEstimatedWorkdays,
} from "../lib/calendar";
import type { Project } from "../types";
import { MODE_LABEL, isOverdue, projectEnd } from "../lib/project";

export default function Progress({
  project,
  compact = false,
}: {
  project: Project;
  compact?: boolean;
}) {
  const { state } = useApp();
  const now = today();
  const overrides = state.settings.calendarOverrides;
  const open = !project.deadline;
  // Open-ended projects measure progress by tasks; their span ends at the latest item.
  const spanEnd = projectEnd(project, state, now);
  const own = state.tasks.filter((t) => t.projectId === project.id);
  const taskRate = own.length
    ? Math.round((own.filter((t) => t.done).length / own.length) * 1000) / 10
    : 0;
  const elapsed =
    project.startDate > now ? 0 : workdays(project.startDate, now, overrides);
  const total = workdays(project.startDate, project.endDate, overrides);
  const remaining = remainingWorkdays(
    project.endDate,
    now,
    overrides,
    project.startDate,
  );
  const percent = open
    ? taskRate
    : projectTimeProgress(project.startDate, project.endDate, now, overrides);
  const milestones = state.milestones
    .filter((item) => item.projectId === project.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = milestones.find((item) => !item.done);
  const nextRemaining = next ? remainingWorkdays(next.date, now, overrides) : 0;
  const late = isOverdue(project, now);
  const overdue = late
    ? workdays(addDays(project.endDate, 1), now, overrides)
    : 0;
  const estimatedProject = hasEstimatedWorkdays(
    project.startDate,
    project.endDate,
    overrides,
  );
  const remainingStart =
    project.startDate > now ? project.startDate : addDays(now, 1);
  const estimatedRemaining = hasEstimatedWorkdays(
    remainingStart,
    project.endDate,
    overrides,
  );
  const estimatedOverdue =
    late && hasEstimatedWorkdays(addDays(project.endDate, 1), now, overrides);
  const estimatedNext =
    !!next &&
    hasEstimatedWorkdays(
      next.date < now ? addDays(next.date, 1) : addDays(now, 1),
      next.date < now ? now : next.date,
      overrides,
    );

  return (
    <section className={`progress-panel ${compact ? "compact" : ""}`}>
      {next && (
        <div className={`next-milestone ${next.date < now ? "overdue" : ""}`}>
          <span>
            <Diamond size={13} fill="currentColor" />{" "}
            {next.date < now ? "待完成里程碑" : "下一个里程碑"}
          </span>
          <strong>{next.title}</strong>
          <div>
            {estimatedNext && <small>预计 </small>}
            {next.date < now ? (
              <>
                <b>{workdays(addDays(next.date, 1), now, overrides)}</b>{" "}
                工作日逾期
              </>
            ) : next.date === now ? (
              <b>今天到期</b>
            ) : (
              <>
                <b>{nextRemaining}</b> 工作日后
              </>
            )}
          </div>
        </div>
      )}
      <div className="progress-main">
        <div className="remaining">
          <span>
            {open ? "已进行" : late ? "项目已逾期" : "剩余工作天数"}
            {!open && (late ? estimatedOverdue : estimatedRemaining)
              ? " · 预计"
              : ""}
          </span>
          <div>
            <strong>{open ? elapsed : late ? overdue : remaining}</strong>
            <small>工作日</small>
          </div>
        </div>
        <div className="timeline-area">
          <div className="timeline-meta">
            <span>
              {open
                ? "任务完成率"
                : `时间进度${estimatedProject ? " · 预计" : ""}`}
            </span>
            <b>
              {Math.round(percent)}
              <small>%</small>
            </b>
          </div>
          <div className="timeline">
            <div className="timeline-fill" style={{ width: `${percent}%` }} />
            {milestones.map((milestone) => {
              const point = projectTimeProgress(
                project.startDate,
                spanEnd,
                milestone.date,
                overrides,
              );
              return (
                <span
                  className={`timeline-milestone ${milestone.done ? "complete" : ""}`}
                  key={milestone.id}
                  title={`${milestone.title} · ${formatDate(milestone.date, state.settings.dateFormat)}${milestone.done ? " · 已达成" : ""}`}
                  style={{ left: `${point}%` }}
                >
                  <Diamond
                    size={13}
                    fill={milestone.done ? "currentColor" : "var(--surface)"}
                  />
                </span>
              );
            })}
            <span
              className="timeline-person"
              style={{ left: `${percent}%` }}
              title="祀陪你走过每一个工作日"
            >
              <span className="si-sprite" aria-label="祀的Q版形象" />
            </span>
          </div>
          <div className="timeline-dates">
            <span>
              {formatDate(project.startDate, state.settings.dateFormat)}
            </span>
            <span>
              {open
                ? "无明确 DDL"
                : formatDate(project.endDate, state.settings.dateFormat)}{" "}
              <Flag size={10} />
            </span>
          </div>
        </div>
      </div>
      <div className="progress-note">
        <span>
          <i className="status-light" />
          {project.status === "completed"
            ? "项目已完成"
            : project.status === "archived"
              ? "项目已归档"
              : open
                ? `${MODE_LABEL.open} · 无明确截止日期，按任务完成率显示`
                : late
                  ? "请检查尚未完成的安排"
                  : "剩余不含今天 · 时间进度计入今天"}
        </span>
        <span>
          {open
            ? `共 ${own.length} 项任务`
            : `${estimatedProject ? "预计共" : "共"} ${total} 个工作日`}
        </span>
      </div>
      {!open && estimatedProject && (
        <p className="calendar-warning">
          排期含尚未收录的节假日日期，按周一至周五预计；手动工作日设置优先。
        </p>
      )}
    </section>
  );
}
