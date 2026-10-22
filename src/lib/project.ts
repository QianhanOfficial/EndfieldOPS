import type { AppState, Project } from "../types";
import { today } from "./calendar";

export const MODE_LABEL = {
  deadline: "工作／复习",
  open: "学习／研发",
} as const;

export const modeLabel = (project: Project) =>
  project.deadline ? MODE_LABEL.deadline : MODE_LABEL.open;

/**
 * Last day a project occupies on calendars. Open-ended projects have no
 * deadline, so they run until their latest scheduled item or today.
 */
export function projectEnd(
  project: Project,
  state: Pick<AppState, "tasks" | "milestones">,
  now = today(),
): string {
  if (project.deadline) return project.endDate;
  let end = project.startDate > now ? project.startDate : now;
  for (const item of [...state.tasks, ...state.milestones])
    if (item.projectId === project.id && item.date > end) end = item.date;
  return end;
}

/** Projects as calendars should draw them, with open-ended spans resolved. */
export function calendarSpan(
  projects: Project[],
  state: Pick<AppState, "tasks" | "milestones">,
  now = today(),
): Project[] {
  return projects.map((p) =>
    p.deadline ? p : { ...p, endDate: projectEnd(p, state, now) },
  );
}

export const isOverdue = (project: Project, now = today()) =>
  project.deadline && project.status === "active" && project.endDate < now;
