export type Difficulty = "normal" | "medium" | "hard";
export type Subtask = { id: string; title: string; done: boolean };
export interface Project {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  members: string[];
  color: string;
  status: "active" | "completed" | "archived";
  order: number;
  createdAt: string;
  updatedAt: string;
}
export interface Task {
  id: string;
  projectId: string;
  requirementId?: string;
  title: string;
  description: string;
  date: string;
  difficulty: Difficulty;
  done: boolean;
  workers: string[];
  subtasks: Subtask[];
  dependencies: string[];
  order: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
export interface Requirement {
  id: string;
  projectId: string;
  batchId: string;
  title: string;
  description: string;
  kind: "new" | "improve" | "retire";
  done: boolean;
  difficulty: Difficulty;
  subtasks: Subtask[];
  order: number;
  createdAt: string;
  updatedAt: string;
}
export interface Batch {
  id: string;
  projectId: string;
  date: string;
  sequence: number;
  createdAt: string;
  updatedAt: string;
}
export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  date: string;
  done: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}
export interface Settings {
  theme: "dark" | "light";
  fontSize: number;
  dateFormat: "YYYY.MM.DD" | "YYYY-MM-DD" | "MM/DD";
  sidebarPinned: boolean;
  calendarHeatmap: "off" | "rate" | "count";
  selfName: string;
  calendarOverrides: Record<string, { workday: boolean; note: string }>;
  reducedMotion: boolean;
}
export interface AppState {
  schemaVersion: number;
  revision: number;
  projects: Project[];
  tasks: Task[];
  requirements: Requirement[];
  batches: Batch[];
  milestones: Milestone[];
  settings: Settings;
}
export type Action = {
  type: string;
  payload: Record<string, unknown>;
  expectedRevision?: number;
};
