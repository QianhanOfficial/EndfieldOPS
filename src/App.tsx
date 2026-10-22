import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  BriefcaseBusiness,
  CalendarDays,
  Gauge,
  Moon,
  Sun,
  PanelLeft,
  Pin,
  PinOff,
  Github,
  ChevronRight,
  ChevronDown,
  Plus,
  ArrowUpRight,
  ArrowUp,
  ArrowLeft,
  Check,
  CheckSquare,
  Square,
  GripHorizontal,
  MoreHorizontal,
  Archive,
  Flag,
  Diamond,
  Clock3,
  Users,
  X,
  List,
  Search,
  Download,
  Upload,
  Save,
  RotateCcw,
  AlertTriangle,
  Trash2,
  FolderOpen,
  Expand,
  Minimize,
  Command,
  SlidersHorizontal,
} from "lucide-react";
import { useApp, useRoute } from "./store";
import type { Project, Task } from "./types";
import {
  today,
  addDays,
  formatDate,
  workdays,
  remainingWorkdays,
  projectTimeProgress,
  periodBreakdown,
  workdayInfo,
  isISODate,
  isSupportedDate,
  hasEstimatedWorkdays,
} from "./lib/calendar";
import { MODE_LABEL, calendarSpan, isOverdue, modeLabel, projectEnd } from "./lib/project";
import OfficialNavIcon from "./components/OfficialNavIcon";
import Calendar from "./components/Calendar";
import Progress from "./components/Progress";
import Workspace from "./components/Workspace";
const NAV = [
  { id: "workspace", label: "工作区", asset: "home" },
  { id: "projects", label: "项目列表", asset: "operator" },
  { id: "status", label: "确认现状", asset: "lore" },
  { id: "calendar", label: "日历", asset: "calendar" },
  { id: "loading", label: "当前负载", asset: "aic-gameplay" },
  { id: "config", label: "系统配置", asset: "notice" },
];
const TABS = [
  ["day", "当日任务"],
  ["requirements", "目标"],
  ["tasks", "任务管理"],
  ["milestones", "里程碑管理"],
  ["background", "项目背景"],
];
const COLORS = [
  "#fffa00",
  "#00ffa2",
  "#ff1aac",
  "#8ca9ef",
  "#e4aa6b",
  "#b9a4dc",
];
export default function App() {
  const { state, act, notify, saving, connected } = useApp();
  const { path, query, navigate } = useRoute();
  const segments = path.split("/").filter(Boolean);
  const section = segments[0] || "projects";
  // Keep legacy browser storage keys so the EOPS rename preserves personal preferences.
  const [saved, setSaved] = useState(
    () => localStorage.getItem("dayline.project") || "",
  );
  const projectId =
    section === "workspace" || section === "status" ? segments[1] || "" : saved;
  const project = state.projects.find((p) => p.id === projectId);
  const view = (segments[2] || "day") as
    | "day"
    | "requirements"
    | "tasks"
    | "milestones"
    | "background";
  const selectedDate = isSupportedDate(query.get("date") || "")
    ? query.get("date")!
    : today();
  const [collapsed, setCollapsed] = useState(false);
  const [projectEditor, setProjectEditor] = useState<Project | "new" | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => Promise<unknown>;
    danger?: boolean;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (path === "/")
      navigate(
        saved && state.projects.some((p) => p.id === saved)
          ? `/workspace/${saved}/day?date=${today()}`
          : "/projects",
      );
  }, []);
  useEffect(() => {
    if (project) {
      setSaved(project.id);
      localStorage.setItem("dayline.project", project.id);
    }
  }, [project?.id]);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
    setScrolled(false);
  }, [section, project?.id, view]);
  function go(id: string) {
    if (id === "workspace" || id === "status")
      navigate(
        saved && state.projects.some((p) => p.id === saved)
          ? `/${id}/${saved}${id === "workspace" ? "/day?date=" + today() : ""}`
          : `/${id}`,
      );
    else navigate("/" + id);
  }
  function selectProject(p: Project, date = today()) {
    setSaved(p.id);
    localStorage.setItem("dayline.project", p.id);
    navigate(`/workspace/${p.id}/day?date=${date}`);
  }
  function ask(
    title: string,
    message: string,
    action: () => Promise<unknown>,
    danger = false,
  ) {
    setConfirm({ title, message, action, danger });
  }
  const scopeTasks = state.tasks.filter((t) => t.projectId === project?.id);
  const scopeMilestones = state.milestones.filter(
    (m) => m.projectId === project?.id,
  );
  const navTitle = NAV.find((n) => n.id === section)?.label || "项目列表";
  return (
    <div
      className={`app-shell ${state.settings.sidebarPinned ? "pinned" : ""}`}
    >
      <aside className="sidebar">
        <button
          className="wordmark"
          onClick={() => go("projects")}
          aria-label="EOPS 终末地工业行动中枢首页"
        >
          <img
            className="endfield-logo"
            src={`/assets/eops-logo-${state.settings.theme === "dark" ? "white" : "black"}.svg`}
            alt="EOPS 终末地工业行动中枢"
            width="46"
            height="51"
          />
        </button>
        <div className="sidebar-divider" />
        <nav>
          {NAV.map((n) => (
            <button
              key={n.id}
              title={n.label}
              aria-current={section === n.id ? "page" : undefined}
              className={`nav-item ${section === n.id ? "active" : ""}`}
              onClick={() => go(n.id)}
            >
              <OfficialNavIcon name={n.asset} />
              <span className="nav-label">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={() =>
              act("settings.update", {
                theme: state.settings.theme === "dark" ? "light" : "dark",
              }).catch(() => {})
            }
            title="切换浅色/深色"
          >
            {state.settings.theme === "dark" ? (
              <Sun size={19} />
            ) : (
              <Moon size={19} />
            )}
            <span>
              {state.settings.theme === "dark" ? "切换浅色" : "切换深色"}
            </span>
          </button>
          <button
            className="nav-item"
            onClick={() =>
              act("settings.update", {
                sidebarPinned: !state.settings.sidebarPinned,
              }).catch(() => {})
            }
            title="固定展开在左侧"
          >
            {state.settings.sidebarPinned ? (
              <PinOff size={19} />
            ) : (
              <Pin size={19} />
            )}
            <span>
              固定展开在左侧
            </span>
            <b
              className={`switch ${state.settings.sidebarPinned ? "on" : ""}`}
            />
          </button>
          <a
            className="nav-item"
            href="https://github.com/QianhanOfficial/EndfieldOPS"
            target="_blank"
            rel="noreferrer"
            title="GitHub 仓库"
          >
            <Github size={19} />
            <span>
              GitHub 仓库
            </span>
            <ArrowUpRight size={13} />
          </a>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-root" title="EOPS 终末地工业行动中枢">EOPS</span>
            <ChevronRight size={13} />
            <strong>{navTitle}</strong>
            {project && (section === "workspace" || section === "status") && (
              <>
                <ChevronRight size={13} />
                <button onClick={() => setProjectEditor(project)}>
                  <i style={{ background: project.color }} />
                  {project.title}
                </button>
              </>
            )}
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <i className="status-light" />
              {!connected ? "连接中断" : saving ? "正在保存…" : "本机已保存"}
            </span>
            <span className="topbar-date">
              {formatDate(today(), state.settings.dateFormat)}
            </span>
            <span className="avatar">
              {state.settings.selfName.slice(0, 1)}
            </span>
          </div>
        </header>
        {section === "workspace" && project && (
          <div className="workspace-nav">
            <div className="subtabs">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  className={view === id ? "active" : ""}
                  onClick={() =>
                    navigate(
                      `/workspace/${project.id}/${id}${id === "day" ? "?date=" + selectedDate : ""}`,
                    )
                  }
                >
                  {label}
                  {id === "day" && view === id && (
                    <small>{selectedDate.slice(5).replace("-", ".")}</small>
                  )}
                </button>
              ))}
            </div>
            <button
              className="icon-btn"
              title={collapsed ? "展开项目日历" : "折叠项目日历"}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <Expand size={16} /> : <Minimize size={16} />}
            </button>
          </div>
        )}
        <main
          ref={contentRef}
          className={`main-content section-${section}`}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 220)}
        >
          {section === "projects" && (
            <Projects
              onSelect={selectProject}
              onEdit={setProjectEditor}
              ask={ask}
            />
          )}
          {section === "workspace" &&
            (project ? (
              <div
                className={`workspace-layout ${collapsed ? "calendar-collapsed" : ""}`}
              >
                <div className="workspace-editor">
                  <Workspace
                    project={project}
                    view={view}
                    date={selectedDate}
                    onView={(v) => navigate(`/workspace/${project.id}/${v}`)}
                    onDate={(date) =>
                      navigate(`/workspace/${project.id}/day?date=${date}`)
                    }
                  />
                </div>
                {!collapsed && (
                  <aside className="workspace-overview">
                    <Progress project={project} compact />
                    <Calendar
                      projects={calendarSpan([project], state)}
                      tasks={scopeTasks}
                      milestones={scopeMilestones}
                      selectedDate={selectedDate}
                      onSelect={(date) =>
                        navigate(`/workspace/${project.id}/day?date=${date}`)
                      }
                      compact
                    />
                  </aside>
                )}
              </div>
            ) : (
              <EmptyWorkspace onPick={() => go("projects")} />
            ))}
          {section === "status" &&
            (project ? (
              <Status
                project={project}
                onEdit={() => setProjectEditor(project)}
                onDay={(d) =>
                  d
                    ? selectProject(project, d)
                    : navigate(`/workspace/${project.id}/tasks`)
                }
              />
            ) : (
              <EmptyWorkspace onPick={() => go("projects")} />
            ))}
          {section === "calendar" && (
            <GlobalCalendar
              selectedDate={selectedDate}
              onDate={(d) => navigate("/calendar?date=" + d)}
              onProject={selectProject}
            />
          )}
          {section === "loading" && <Workload onProject={selectProject} />}
          {section === "config" && <Config ask={ask} />}
          {!NAV.some((n) => n.id === section) && (
            <EmptyWorkspace onPick={() => go("projects")} />
          )}
        </main>
        {scrolled && (
          <button
            className="back-top"
            aria-label="返回顶部"
            onClick={() =>
              contentRef.current?.scrollTo({
                top: 0,
                behavior: state.settings.reducedMotion ? "instant" : "smooth",
              })
            }
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
      {projectEditor && (
        <ProjectEditor
          project={projectEditor === "new" ? undefined : projectEditor}
          onClose={() => setProjectEditor(null)}
          onCreated={selectProject}
        />
      )}
      {confirm && (
        <Dialog
          title={confirm.title}
          onClose={() => !confirmBusy && setConfirm(null)}
        >
          <p className="confirm-text">{confirm.message}</p>
          <div className="dialog-actions">
            <button
              className="btn"
              disabled={confirmBusy}
              onClick={() => setConfirm(null)}
            >
              取消
            </button>
            <button
              className={`btn ${confirm.danger ? "danger" : "primary"}`}
              disabled={confirmBusy}
              onClick={async () => {
                setConfirmBusy(true);
                try {
                  await confirm.action();
                  setConfirm(null);
                } catch {
                } finally {
                  setConfirmBusy(false);
                }
              }}
            >
              {confirmBusy ? "处理中…" : "确认"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function EmptyWorkspace({ onPick }: { onPick: () => void }) {
  return (
    <div className="empty-workspace">
      <div className="empty-illustration">
        <LayoutGrid size={42} />
        <span>＋</span>
      </div>
      <h1>当前没有选定项目</h1>
      <p>
        选择项目后，可查看目标、任务和日程。 ( ˶˙ᵕ˙˶ )
      </p>
      <button className="btn primary" onClick={onPick}>
        前往项目列表
        <ArrowUpRight size={16} />
      </button>
    </div>
  );
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current
      ?.querySelector<HTMLElement>("input,button,textarea,select")
      ?.focus();
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const all = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]',
          ) || []),
        ];
        const first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", fn);
    return () => {
      window.removeEventListener("keydown", fn);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-title">
          <div>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function ProjectEditor({
  project,
  onClose,
  onCreated,
}: {
  project?: Project;
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const { state, act } = useApp();
  const [title, setTitle] = useState(project?.title || "");
  const [start, setStart] = useState(project?.startDate || today());
  const [end, setEnd] = useState(project?.endDate || addDays(today(), 28));
  const [deadline, setDeadline] = useState(project?.deadline ?? true);
  const [description, setDescription] = useState(project?.description || "");
  const [members, setMembers] = useState(
    (project?.members || [state.settings.selfName]).join("、"),
  );
  const [color, setColor] = useState(project?.color || COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={project ? "编辑项目资料" : "新建项目"} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            project &&
            state.projects.find((p) => p.id === project.id)?.updatedAt !==
              project.updatedAt
          ) {
            setError(
              "项目已在其他窗口或工具中更新。请保留当前文字，关闭后重新打开编辑。",
            );
            return;
          }
          const fields = new FormData(e.currentTarget);
          const formStart = String(fields.get("startDate") || start);
          // Open-ended projects keep a placeholder end date that nothing reads.
          const formEnd = deadline
            ? String(fields.get("endDate") || end)
            : end >= formStart
              ? end
              : formStart;
          if (formEnd < formStart) {
            setError("截止日期应晚于或等于起始日期");
            return;
          }
          setBusy(true);
          try {
            const payload = {
              title: title.trim(),
              startDate: formStart,
              endDate: formEnd,
              deadline,
              description,
              members: [
                ...new Set([
                  state.settings.selfName,
                  ...members
                    .split(/[,，、\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                ]),
              ],
              color,
            };
            const next = await act(
              project ? "project.update" : "project.create",
              { ...payload, ...(project ? { id: project.id } : {}) },
            );
            onClose();
            if (!project) {
              const p = next.projects.find(
                (p) => !state.projects.some((old) => old.id === p.id),
              );
              if (p) onCreated(p);
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          项目名称
          <input
            autoFocus
            required
            maxLength={120}
            placeholder="项目名称"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="mode-picker" role="radiogroup" aria-label="项目类型">
          {(
            [
              [true, MODE_LABEL.deadline, "有明确截止日期，按剩余工作日推进"],
              [false, MODE_LABEL.open, "没有明确截止日期，按任务完成情况推进"],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              type="button"
              role="radio"
              aria-checked={deadline === value}
              key={label}
              className={deadline === value ? "active" : ""}
              onClick={() => setDeadline(value)}
            >
              <strong>{label}</strong>
              <small>{hint}</small>
            </button>
          ))}
        </div>
        <div className="form-row">
          <label>
            {deadline ? "参考起始日期" : "开始日期"}
            <input
              required
              type="date"
              name="startDate"
              min="1900-01-01"
              max="2099-12-31"
              value={start}
              onInput={(e) => setStart(e.currentTarget.value)}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          {deadline && (
            <label>
              参考截止日期
              <input
                required
                type="date"
                name="endDate"
                min={start || "1900-01-01"}
                max="2099-12-31"
                value={end}
                onInput={(e) => setEnd(e.currentTarget.value)}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          )}
        </div>
        <p className="field-hint">
          {deadline
            ? "日期用于初始规划，后续可自由调整。"
            : "无截止日期的项目默认不显示在全局日历上，可在日历页打开。"}
          {deadline && isSupportedDate(start) && isSupportedDate(end) && end >= start
            ? `${hasEstimatedWorkdays(start, end, state.settings.calendarOverrides) ? "预计" : ""}共 ${workdays(start, end, state.settings.calendarOverrides)} 个工作日。`
            : ""}
        </p>
        <label>
          项目背景
          <textarea
            rows={4}
            placeholder="项目想解决什么问题？你目前如何理解它？支持 Markdown。"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          项目成员
          <input
            value={members}
            onChange={(e) => setMembers(e.target.value)}
            placeholder="自己、张三、李四"
          />
          <small>用逗号或顿号分隔。任务完成时可以多选。</small>
        </label>
        <label>
          项目标识色
          <div className="color-picker">
            {COLORS.map((c) => (
              <button
                aria-label={"选择颜色 " + c}
                type="button"
                key={c}
                style={{ background: c }}
                className={color === c ? "chosen" : ""}
                onClick={() => setColor(c)}
              >
                {color === c && <Check size={16} />}
              </button>
            ))}
          </div>
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "保存中…" : project ? "保存项目" : "创建并进入工作区"}
            <ArrowUpRight size={15} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function Projects({
  onSelect,
  onEdit,
  ask,
}: {
  onSelect: (p: Project) => void;
  onEdit: (p: Project | "new") => void;
  ask: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
    danger?: boolean,
  ) => void;
}) {
  const { state, act, notify } = useApp();
  const [mode, setMode] = useState<"grid" | "list">(() =>
    localStorage.getItem("dayline.projects.view") === "list" ? "list" : "grid",
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState<string[]>([]);
  const [selection, setSelection] = useState(false);
  const [dragged, setDragged] = useState("");
  const [menu, setMenu] = useState("");
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const current = state.projects
    .filter(
      (p) =>
        (filter === "all" || p.status === filter) &&
        p.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (a.status === "completed" ? 1 : 0) -
          (b.status === "completed" ? 1 : 0) || a.order - b.order,
    );
  const active = state.projects.filter((p) => p.status === "active").length;
  const due = state.projects.filter((p) => isOverdue(p)).length;
  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  }
  return (
    <div className="page projects-page">
      <div className="page-heading">
        <div>
          <h1>项目列表</h1>
          <p>选择项目进入工作区，或新建项目。</p>
        </div>
        <button className="btn primary" onClick={() => onEdit("new")}>
          <Plus size={17} />
          新建项目
        </button>
      </div>
      <div className="project-summary">
        <div>
          <span>进行中</span>
          <strong>{String(active).padStart(2, "0")}</strong>
          <small>个项目</small>
        </div>
        <div>
          <span>今日任务</span>
          <strong>
            {String(
              state.tasks.filter((t) => t.date === today()).length,
            ).padStart(2, "0")}
          </strong>
          <small>项安排</small>
        </div>
        <div>
          <span>待达成里程碑</span>
          <strong>
            {String(
              state.milestones.filter(
                (m) =>
                  !m.done &&
                  state.projects.some(
                    (p) => p.id === m.projectId && p.status === "active",
                  ),
              ).length,
            ).padStart(2, "0")}
          </strong>
          <small>个节点</small>
        </div>
        <div className={due ? "attention" : ""}>
          <span>已逾期</span>
          <strong>{String(due).padStart(2, "0")}</strong>
          <small>个逾期项目</small>
        </div>
      </div>
      <div className="list-toolbar">
        <div className="tabs-inline">
          {[
            ["active", "进行中"],
            ["completed", "已完成"],
            ["archived", "已归档"],
            ["all", "全部"],
          ].map(([v, t]) => (
            <button
              key={v}
              className={filter === v ? "active" : ""}
              onClick={() => {
                setFilter(v);
                setSelected([]);
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <div className="search-input">
            <Search size={15} />
            <input
              aria-label="搜索项目"
              placeholder="搜索项目"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            title="多选项目"
            className={`icon-btn ${selection ? "selected-btn" : ""}`}
            onClick={() => {
              setSelection(!selection);
              setSelected([]);
            }}
          >
            <CheckSquare size={17} />
          </button>
          <div className="segmented icon-segment">
            {(["grid", "list"] as const).map((v) => (
              <button
                title={v === "grid" ? "方格视图" : "列表视图"}
                key={v}
                className={mode === v ? "active" : ""}
                onClick={() => {
                  setMode(v);
                  localStorage.setItem("dayline.projects.view", v);
                }}
              >
                {v === "grid" ? <LayoutGrid size={16} /> : <List size={16} />}
              </button>
            ))}
          </div>
        </div>
      </div>
      {selection && (
        <div className="selection-bar">
          <span>已选 {selected.length} 个项目</span>
          <button
            className="btn small"
            disabled={!selected.length}
            onClick={() =>
              ask(
                "归档所选项目",
                `归档后仍保留所有目标、任务与历史，可以随时恢复。`,
                async () => {
                  for (const id of selected)
                    await act("project.update", { id, status: "archived" });
                  setSelected([]);
                },
              )
            }
          >
            归档
          </button>
          <button
            className="btn small danger-ghost"
            disabled={!selected.length}
            onClick={() =>
              ask(
                "删除所选项目",
                `将删除 ${selected.length} 个项目及其所有任务、目标和里程碑。此操作请先确认备份。`,
                async () => {
                  for (const id of selected)
                    await act("project.delete", { id });
                  setSelected([]);
                },
                true,
              )
            }
          >
            删除
          </button>
        </div>
      )}
      <div className={`projects-${mode}`}>
        {current.map((p, index) => {
          const tasks = state.tasks.filter((t) => t.projectId === p.id);
          const done = tasks.filter((t) => t.done).length;
          const rate = tasks.length
            ? Math.round((done / tasks.length) * 100)
            : 0;
          const next = state.milestones
            .filter((m) => m.projectId === p.id && !m.done)
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          return (
            <article
              key={p.id}
              className={`project-card ${selected.includes(p.id) ? "is-selected" : ""}`}
              style={{ "--project-color": p.color } as React.CSSProperties}
              onDragOver={(e) => {
                if (dragged) e.preventDefault();
              }}
              onDrop={async (e) => {
                e.preventDefault();
                if (!dragged || dragged === p.id) return;
                const sorted = [...state.projects]
                  .sort((a, b) => a.order - b.order)
                  .map((x) => x.id);
                sorted.splice(sorted.indexOf(dragged), 1);
                sorted.splice(sorted.indexOf(p.id), 0, dragged);
                setDragged("");
                await act("project.reorder", { ids: sorted }).catch(() => {});
              }}
            >
              <div className="project-card-top">
                <span className="project-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <button
                    className="drag-handle"
                    aria-label={"拖动项目 " + p.title}
                    draggable
                    onDragStart={(e) => {
                      setDragged(p.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", p.id);
                    }}
                    onDragEnd={() => setDragged("")}
                  >
                    <GripHorizontal size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={"项目操作 " + p.title}
                    onClick={() => setMenu(menu === p.id ? "" : p.id)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                </div>
              </div>
              <button
                className="project-open"
                onPointerDown={() => {
                  longPressed.current = false;
                  press.current = setTimeout(() => {
                    longPressed.current = true;
                    setSelection(true);
                    toggle(p.id);
                  }, 550);
                }}
                onPointerUp={() => clearTimeout(press.current)}
                onPointerLeave={() => clearTimeout(press.current)}
                onClick={() => {
                  if (longPressed.current) {
                    longPressed.current = false;
                    return;
                  }
                  selection ? toggle(p.id) : onSelect(p);
                }}
              >
                <div className="project-title-line">
                  {selection ? (
                    <span className="project-select">
                      {selected.includes(p.id) ? (
                        <CheckSquare size={19} />
                      ) : (
                        <Square size={19} />
                      )}
                    </span>
                  ) : (
                    <span className="project-glyph">
                      <FolderOpen size={20} />
                    </span>
                  )}
                  <h2>{p.title}</h2>
                  <ArrowUpRight size={20} />
                </div>
                <p className="project-description">
                  {p.description?.replace(/[#*`>]/g, "").slice(0, 100) ||
                    "还没有背景说明，记录下你对项目的理解。"}
                </p>
                <div className="project-date">
                  <CalendarDays size={13} />
                  {formatDate(p.startDate, state.settings.dateFormat)}{" "}
                  <span>—</span>{" "}
                  {p.deadline
                    ? formatDate(p.endDate, state.settings.dateFormat)
                    : "无明确 DDL"}
                  <span className={`mode-tag ${p.deadline ? "" : "open"}`}>
                    {modeLabel(p)}
                  </span>
                </div>
                <div className="project-progress-label">
                  <span>
                    任务进度{" "}
                    <strong>
                      {done}/{tasks.length}
                    </strong>
                  </span>
                  <b>
                    {rate}
                    <small>%</small>
                  </b>
                </div>
                <div className="thin-progress">
                  <i style={{ width: rate + "%" }} />
                </div>
                <div className="project-card-footer">
                  <span
                    className={`badge ${isOverdue(p) ? "warning" : ""}`}
                  >
                    {p.status === "completed"
                      ? "已完成"
                      : p.status === "archived"
                        ? "已归档"
                        : isOverdue(p)
                          ? "已逾期"
                          : p.startDate > today()
                            ? "待开始"
                            : "进行中"}
                  </span>
                  <span>
                    {next ? (
                      <>
                        <Diamond size={11} />
                        {next.title}
                      </>
                    ) : (
                      <>
                        <Users size={12} />
                        {p.members.length} 位成员
                      </>
                    )}
                  </span>
                </div>
              </button>
              {menu === p.id && (
                <div className="project-menu">
                  <button
                    onClick={() => {
                      setMenu("");
                      onEdit(p);
                    }}
                  >
                    编辑项目资料
                  </button>
                  <button
                    onClick={() => {
                      setMenu("");
                      ask(
                        p.status === "completed"
                          ? "重新打开项目"
                          : "确认完成项目",
                        p.status === "completed"
                          ? "项目将重新进入进行中列表。"
                          : `还有 ${tasks.filter((t) => !t.done).length} 项任务、${state.milestones.filter((m) => m.projectId === p.id && !m.done).length} 个里程碑未完成。确认后项目标记为完成，任务状态保持原样。`,
                        () =>
                          act("project.update", {
                            id: p.id,
                            status:
                              p.status === "completed" ? "active" : "completed",
                          }),
                      );
                    }}
                  >
                    {p.status === "completed" ? "重新打开" : "标记完成"}
                  </button>
                  <button
                    onClick={() => {
                      setMenu("");
                      act("project.update", {
                        id: p.id,
                        status: p.status === "archived" ? "active" : "archived",
                      }).catch(() => {});
                    }}
                  >
                    {p.status === "archived" ? "恢复项目" : "归档项目"}
                  </button>
                  <button
                    className="danger-text"
                    onClick={() => {
                      setMenu("");
                      ask(
                        "删除项目",
                        `删除「${p.title}」及其所有条目？`,
                        () => act("project.delete", { id: p.id }),
                        true,
                      );
                    }}
                  >
                    删除项目
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {!current.length && (
        <div className="empty-list">
          <BriefcaseBusiness size={32} />
          <h3>
            {search
              ? "没有找到匹配项目"
              : state.projects.length
                ? "这里暂时没有项目"
                : "还没有项目"}
          </h3>
          <p>
            {state.projects.length
              ? "换个筛选条件，或者新建一个项目。"
              : "新建项目时填写背景和日期，任务在工作区添加。"}
          </p>
          <div>
            <button className="btn primary" onClick={() => onEdit("new")}>
              <Plus size={16} />
              新建项目
            </button>
            {!state.projects.length && (
              <button
                className="btn"
                onClick={() =>
                  act("demo.load")
                    .then(() => notify("已载入三个演示项目，可随时删除。"))
                    .catch(() => {})
                }
              >
                体验示例项目
                <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="page-footnote">
        <span>项目可通过右上角手柄调整顺序 · 顺序同步到全局日历</span>
      </div>
    </div>
  );
}
function TaskRows({
  tasks,
  onProject,
  showDate = false,
}: {
  tasks: Task[];
  onProject?: (p: Project, d?: string) => void;
  showDate?: boolean;
}) {
  const { state, act } = useApp();
  return (
    <div className="simple-task-list">
      {tasks.map((t) => {
        const p = state.projects.find((p) => p.id === t.projectId);
        return (
          <div className={`simple-task ${t.done ? "done" : ""}`} key={t.id}>
            <button
              className="task-check"
              aria-label={(t.done ? "取消完成 " : "完成 ") + t.title}
              onClick={() =>
                act("task.update", { id: t.id, done: !t.done }).catch(() => {})
              }
            >
              {t.done ? <Check size={13} /> : null}
            </button>
            <div>
              <strong>{t.title}</strong>
              {p && (
                <button
                  className="task-project-link"
                  onClick={() => onProject?.(p, t.date)}
                >
                  <i style={{ background: p.color }} />
                  {p.title}
                  {showDate && (
                    <span>
                      {" "}
                      ·{" "}
                      {t.date
                        ? formatDate(t.date, state.settings.dateFormat)
                        : "未安排日期"}
                    </span>
                  )}
                </button>
              )}
              {t.description && <p>{t.description}</p>}
            </div>
            <span className={"difficulty " + t.difficulty}>
              {{ normal: "一般", medium: "中等", hard: "高难" }[t.difficulty]}
            </span>
          </div>
        );
      })}
      {!tasks.length && (
        <div className="quiet-empty">这一天还没有安排，留点空间也很好。</div>
      )}
    </div>
  );
}
function GlobalCalendar({
  selectedDate,
  onDate,
  onProject,
}: {
  selectedDate: string;
  onDate: (d: string) => void;
  onProject: (p: Project, d?: string) => void;
}) {
  const { state, act } = useApp();
  const visible = state.projects.filter((p) => p.status !== "archived");
  const showOpen = state.settings.calendarShowOpen;
  const openCount = visible.filter((p) => !p.deadline).length;
  // Open-ended projects stay off the calendar unless the user asks for them.
  const projects = calendarSpan(
    visible.filter((p) => p.deadline || showOpen),
    state,
  );
  const rows = state.tasks
    .filter(
      (t) =>
        t.date === selectedDate && projects.some((p) => p.id === t.projectId),
    )
    .sort((a, b) => a.order - b.order);
  const done = rows.filter((t) => t.done).length;
  const info = workdayInfo(selectedDate, state.settings.calendarOverrides);
  return (
    <div className="page calendar-page">
      <div className="page-heading">
        <div>
          <h1>日历</h1>
          <p>点击日期查看当天的项目和任务。</p>
        </div>
        {openCount > 0 && (
          <button
            className={`btn toggle-open ${showOpen ? "active" : ""}`}
            aria-pressed={showOpen}
            onClick={() =>
              act("settings.update", { calendarShowOpen: !showOpen }).catch(
                () => {},
              )
            }
          >
            {showOpen ? "隐藏" : "显示"}无 DDL 项目 · {openCount}
          </button>
        )}
        <span className="outline-label">
          {projects.length} 个项目 /{" "}
          {projects.reduce(
            (n, p) =>
              n +
              state.tasks.filter((t) => t.projectId === p.id && !t.done).length,
            0,
          )}{" "}
          项待完成
        </span>
      </div>
      <div className="global-calendar-layout">
        <Calendar
          projects={projects}
          tasks={state.tasks.filter((t) =>
            projects.some((p) => p.id === t.projectId),
          )}
          milestones={state.milestones.filter((m) =>
            projects.some((p) => p.id === m.projectId),
          )}
          selectedDate={selectedDate}
          onSelect={onDate}
        />
        <aside className="day-detail">
          <div className="day-detail-heading">
            <h2>{formatDate(selectedDate, state.settings.dateFormat)}</h2>
            <p>
              {info.lunar} · {info.workday ? "工作日" : "休息日"}
              {info.estimated ? "（预计）" : ""}
            </p>
          </div>
          <div className="day-total">
            <strong>
              {done}
              <small>/{rows.length}</small>
            </strong>
            <span>
              项已完成
              <b>
                {rows.length ? Math.round((done / rows.length) * 100) : 100}%
              </b>
            </span>
          </div>
          <div className="day-detail-body">
            {state.milestones
              .filter(
                (m) =>
                  m.date === selectedDate &&
                  projects.some((p) => p.id === m.projectId),
              )
              .map((m) => (
                <div className="milestone-callout" key={m.id}>
                  <Diamond size={15} />
                  <div>
                    <strong>{m.title}</strong>
                    <small>{m.done ? "已达成" : "里程碑 · 待达成"}</small>
                  </div>
                </div>
              ))}
            <TaskRows tasks={rows} onProject={onProject} />
            <h4 className="eyebrow day-project-label">当天进行的项目</h4>
            {projects
              .filter(
                (p) => p.startDate <= selectedDate && p.endDate >= selectedDate,
              )
              .sort((a, b) => a.order - b.order)
              .map((p) => (
                <button
                  className="day-project"
                  key={p.id}
                  onClick={() => onProject(p, selectedDate)}
                >
                  <i style={{ background: p.color }} />
                  <span>{p.title}</span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
function Status({
  project,
  onEdit,
  onDay,
}: {
  project: Project;
  onEdit: () => void;
  onDay: (d: string) => void;
}) {
  const { state } = useApp();
  const tasks = state.tasks.filter((t) => t.projectId === project.id);
  const done = tasks.filter((t) => t.done);
  const remaining = tasks.filter((t) => !t.done);
  const milestones = state.milestones
    .filter((m) => m.projectId === project.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const end = projectEnd(project, state);
  const periods = periodBreakdown(
    project.startDate,
    end,
    state.settings.calendarOverrides,
  );
  const [period, setPeriod] = useState<"week" | "month">("week");
  return (
    <div className="page status-page">
      <div className="page-heading">
        <div>
          <h1>{project.title}</h1>
          <p>查看任务、里程碑与工作日统计。</p>
        </div>
        <button className="btn" onClick={onEdit}>
          <SlidersHorizontal size={15} />
          编辑项目资料
        </button>
      </div>
      <div className="sticky-progress">
        <Progress project={project} />
      </div>
      <div className="status-metrics">
        <Metric
          label="任务完成率"
          value={
            tasks.length ? Math.round((done.length / tasks.length) * 100) : 0
          }
          unit="%"
          caption={`${done.length} / ${tasks.length} 项任务`}
        />
        <Metric
          label="剩余任务"
          value={remaining.length}
          unit="项"
          caption={`${remaining.filter((t) => t.date && t.date < today()).length} 项已逾期`}
        />
        <Metric
          label="里程碑"
          value={milestones.filter((m) => m.done).length}
          unit={"/ " + milestones.length}
          caption="已达成 / 全部"
        />
        <Metric
          label="目标"
          value={
            state.requirements.filter((r) => r.projectId === project.id).length
          }
          unit="条"
          caption={`${state.batches.filter((b) => b.projectId === project.id).length} 批目标`}
        />
      </div>
      <div className="status-grid">
        <section className="surface-card">
          <div className="card-heading">
            <h3>待办任务</h3>
          </div>
          <TaskRows
            tasks={remaining
              .sort(
                (a, b) =>
                  (a.date || "9999").localeCompare(b.date || "9999") ||
                  a.order - b.order,
              )
              .slice(0, 8)}
            showDate
            onProject={(_, d) => onDay(d ?? today())}
          />
        </section>
        <section className="surface-card">
          <div className="card-heading">
            <h3>最近完成</h3>
          </div>
          <TaskRows
            tasks={[...done]
              .sort((a, b) =>
                (b.completedAt || "").localeCompare(a.completedAt || ""),
              )
              .slice(0, 8)}
            showDate
            onProject={(_, d) => onDay(d ?? today())}
          />
        </section>
        <section className="surface-card">
          <div className="card-heading">
            <h3>里程碑</h3>
          </div>
          <div className="status-milestones">
            {milestones.map((m) => (
              <button
                key={m.id}
                onClick={() => onDay(m.date)}
                className={m.done ? "done" : ""}
              >
                <Diamond size={18} fill={m.done ? "currentColor" : "none"} />
                <div>
                  <strong>{m.title}</strong>
                  <small>{formatDate(m.date, state.settings.dateFormat)}</small>
                </div>
                <span className="badge">
                  {m.done ? "已达成" : m.date < today() ? "已逾期" : "待达成"}
                </span>
              </button>
            ))}
            {!milestones.length && (
              <p className="quiet-empty">
                暂无里程碑，可在工作区添加。
              </p>
            )}
          </div>
        </section>
        <section className="surface-card">
          <div className="card-heading">
            <h3>工作日分布</h3>
            <div className="segmented">
              <button
                className={period === "week" ? "active" : ""}
                onClick={() => setPeriod("week")}
              >
                按周
              </button>
              <button
                className={period === "month" ? "active" : ""}
                onClick={() => setPeriod("month")}
              >
                按月
              </button>
            </div>
          </div>
          <p className="field-hint">
            每周、每月按实际日期统计，不作固定天数折算。
            {hasEstimatedWorkdays(
              project.startDate,
              end,
              state.settings.calendarOverrides,
            ) && (
              <span> 部分日期超过已公布的 2026 年日历，按周一至周五预计。</span>
            )}
          </p>
          <div className="periods">
            {(period === "week" ? periods.byWeek : periods.byMonth).map(
              (row) => (
                <div key={row.start}>
                  <span>
                    {row.label}
                    <small>
                      {row.start.slice(5)}—{row.end.slice(5)}
                    </small>
                  </span>
                  <div>
                    <i
                      style={{
                        width:
                          Math.min(
                            100,
                            (row.workdays / (period === "week" ? 7 : 31)) * 100,
                          ) + "%",
                      }}
                    />
                  </div>
                  <b>
                    {row.workdays}
                    <small> 工作日</small>
                  </b>
                </div>
              ),
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
function Metric({
  label,
  value,
  unit,
  caption,
}: {
  label: string;
  value: number;
  unit: string;
  caption: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <div>
        <strong>{value}</strong>
        <small>{unit}</small>
      </div>
      <p>{caption}</p>
    </div>
  );
}
function Workload({
  onProject,
}: {
  onProject: (p: Project, d?: string) => void;
}) {
  const { state } = useApp();
  const now = today();
  const projects = state.projects
    .filter(
      (p) =>
        p.status === "active" &&
        ((p.startDate <= now && (!p.deadline || p.endDate >= now)) ||
          state.tasks.some((t) => t.projectId === p.id && t.date === now) ||
          isOverdue(p, now)),
    )
    .sort((a, b) => a.order - b.order);
  const tasks = state.tasks.filter(
    (t) =>
      t.date === now &&
      state.projects.some((p) => p.id === t.projectId && p.status === "active"),
  );
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="page workload-page">
      <div className="page-heading">
        <div>
          <h1>当前负载</h1>
          <p>
            {formatDate(now, state.settings.dateFormat)} ·{" "}
            {workdayInfo(now, state.settings.calendarOverrides).lunar}
          </p>
        </div>
      </div>
      <div className="workload-summary">
        <div>
          <span className="eyebrow">今日任务</span>
          <h2>
            {done}
            <span> / {tasks.length}</span>
            <small>项</small>
          </h2>
        </div>
        <div className="workload-progress">
          <div>
            <span>{tasks.length ? "今日完成率" : "今天暂无安排"}</span>
            <strong>
              {tasks.length ? Math.round((done / tasks.length) * 100) : 100}%
            </strong>
          </div>
          <div className="thin-progress">
            <i
              style={{
                width: (tasks.length ? (done / tasks.length) * 100 : 100) + "%",
              }}
            />
          </div>
        </div>
        <div>
          <span>当前项目</span>
          <strong>{projects.length}</strong>
          <small>个项目</small>
        </div>
      </div>
      <div className="workload-cards">
        {projects.map((p) => {
          const next = state.milestones
            .filter((m) => m.projectId === p.id && !m.done)
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          const ptasks = tasks
            .filter((t) => t.projectId === p.id)
            .sort((a, b) => a.order - b.order);
          const own = state.tasks.filter((t) => t.projectId === p.id);
          // Open-ended projects have no time axis; show task completion instead.
          const pct = p.deadline
            ? projectTimeProgress(
                p.startDate,
                p.endDate,
                now,
                state.settings.calendarOverrides,
              )
            : own.length
              ? Math.round(
                  (own.filter((t) => t.done).length / own.length) * 100,
                )
              : 0;
          return (
            <section
              className="surface-card workload-card"
              key={p.id}
              style={{ "--project-color": p.color } as React.CSSProperties}
            >
              <button
                className="workload-project-header"
                onClick={() => onProject(p, now)}
              >
                <span className="project-glyph">
                  <FolderOpen size={18} />
                </span>
                <div>
                  <h2>{p.title}</h2>
                  <span>
                    {p.deadline ? (
                      <>
                        {hasEstimatedWorkdays(
                          p.startDate,
                          p.endDate,
                          state.settings.calendarOverrides,
                        )
                          ? "预计时间进度"
                          : "时间进度"}{" "}
                        {Math.round(pct)}% ·{" "}
                        {p.endDate < now
                          ? "已逾期"
                          : `剩余 ${remainingWorkdays(p.endDate, now, state.settings.calendarOverrides, p.startDate)} 工作日`}
                      </>
                    ) : (
                      `${MODE_LABEL.open} · 任务完成 ${own.filter((t) => t.done).length}/${own.length}`
                    )}
                  </span>
                </div>
                <ArrowUpRight size={20} />
              </button>
              <div className="thin-progress">
                <i style={{ width: pct + "%" }} />
              </div>
              {next && (
                <div className="workload-next">
                  <Diamond size={12} />
                  <span>{next.title}</span>
                  <strong>
                    {next.date === now
                      ? "今天到期"
                      : next.date < now
                        ? "已逾期"
                        : `${remainingWorkdays(next.date, now, state.settings.calendarOverrides)} 工作日后`}
                  </strong>
                </div>
              )}
              <TaskRows tasks={ptasks} onProject={onProject} />
              <button className="text-link" onClick={() => onProject(p, now)}>
                进入当日任务
                <ChevronRight size={14} />
              </button>
            </section>
          );
        })}
      </div>
      {!projects.length && (
        <div className="empty-list">
          <Gauge size={32} />
          <h3>暂无进行中的项目</h3>
          <p>可在项目列表新建项目，再安排当日任务。</p>
        </div>
      )}
    </div>
  );
}
function Config({
  ask,
}: {
  ask: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
    danger?: boolean,
  ) => void;
}) {
  const { state, act, notify } = useApp();
  const s = state.settings;
  const [name, setName] = useState(s.selfName);
  const [overrideDate, setOverrideDate] = useState(today());
  const [overrideWork, setOverrideWork] = useState(true);
  const [note, setNote] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  return (
    <div className="page config-page">
      <div className="page-heading">
        <div>
          <h1>系统配置</h1>
          <p>设置应用于所有项目。</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="surface-card settings-card">
          <div className="card-heading">
            <h3>界面与显示</h3>
            <Sun size={18} />
          </div>
          <div className="setting-row">
            <div>
              <strong>外观模式</strong>
              <small>默认浅色，可切换为深色。</small>
            </div>
            <div className="segmented">
              {(["dark", "light"] as const).map((v) => (
                <button
                  key={v}
                  className={s.theme === v ? "active" : ""}
                  onClick={() =>
                    act("settings.update", { theme: v }).catch(() => {})
                  }
                >
                  {v === "dark" ? "深色" : "浅色"}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>字体大小</strong>
              <small>同时调整内容和控件文字。</small>
            </div>
            <select
              aria-label="字体大小"
              value={s.fontSize}
              onChange={(e) =>
                act("settings.update", {
                  fontSize: Number(e.target.value),
                }).catch(() => {})
              }
            >
              {[13, 14, 15, 16, 18].map((n) => (
                <option key={n} value={n}>
                  {n} px
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>日期格式</strong>
              <small>仅调整显示，日期含义保持一致。</small>
            </div>
            <select
              aria-label="日期格式"
              value={s.dateFormat}
              onChange={(e) =>
                act("settings.update", { dateFormat: e.target.value }).catch(
                  () => {},
                )
              }
            >
              {["YYYY.MM.DD", "YYYY-MM-DD", "MM/DD"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>固定展开侧栏</strong>
              <small>关闭后移入鼠标自动展开。</small>
            </div>
            <button
              role="switch"
              aria-checked={s.sidebarPinned}
              className={`switch large ${s.sidebarPinned ? "on" : ""}`}
              onClick={() =>
                act("settings.update", {
                  sidebarPinned: !s.sidebarPinned,
                }).catch(() => {})
              }
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>减少动态效果</strong>
              <small>关闭角色浮动和界面过渡。</small>
            </div>
            <button
              role="switch"
              aria-checked={s.reducedMotion}
              className={`switch large ${s.reducedMotion ? "on" : ""}`}
              onClick={() =>
                act("settings.update", {
                  reducedMotion: !s.reducedMotion,
                }).catch(() => {})
              }
            />
          </div>
          <div className="theme-preview">
            <strong>默认风格 · 终末地</strong>
            <div>
              {[
                "#ffffff",
                "#e6e6e6",
                "#191919",
                "#fffa00",
                "#00ffa2",
                "#ff1aac",
              ].map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </div>
            <small>白、灰、黑为主色，#FFFA00 为小面积强调色。</small>
          </div>
        </section>
        <section className="surface-card settings-card">
          <div className="card-heading">
            <h3>个人与工作日</h3>
            <CalendarDays size={18} />
          </div>
          <label>
            自己的显示名称
            <div className="inline-input">
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <button
                className="btn"
                onClick={() =>
                  act("settings.update", { selfName: name.trim() || "自己" })
                    .then(() => notify("名称已保存"))
                    .catch(() => {})
                }
              >
                保存
              </button>
            </div>
          </label>
          <p className="field-hint">
            仅自己完成任务时隐藏工作者信息；项目成员在项目资料中配置。
          </p>
          <div className="setting-divider" />
          <strong>工作日例外</strong>
          <p className="field-hint">
            以中国法定调休为基础；可以手动设置项目管理中需要遵循的休息或工作日。
          </p>
          <div className="form-row">
            <label>
              日期
              <input
                type="date"
                min="1900-01-01"
                max="2099-12-31"
                value={overrideDate}
                onInput={(e) => setOverrideDate(e.currentTarget.value)}
                onChange={(e) => setOverrideDate(e.target.value)}
              />
            </label>
            <label>
              设为
              <select
                value={overrideWork ? "work" : "rest"}
                onChange={(e) => setOverrideWork(e.target.value === "work")}
              >
                <option value="work">工作日</option>
                <option value="rest">休息日</option>
              </select>
            </label>
          </div>
          <label>
            备注
            <input
              placeholder="例如：公司调休"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            className="btn"
            disabled={!overrideDate}
            onClick={() =>
              act("settings.update", {
                calendarOverrides: {
                  ...s.calendarOverrides,
                  [overrideDate]: { workday: overrideWork, note },
                },
              })
                .then(() => notify("日历例外已保存，统计已重新计算"))
                .catch(() => {})
            }
          >
            <Plus size={15} />
            添加例外
          </button>
          <div className="override-list">
            {Object.entries(s.calendarOverrides)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([d, v]) => (
                <div key={d}>
                  <span>
                    {d} · {v.workday ? "班" : "休"}
                    <small>{v.note}</small>
                  </span>
                  <button
                    className="icon-btn"
                    aria-label={"移除例外 " + d}
                    onClick={() => {
                      const copy = { ...s.calendarOverrides };
                      delete copy[d];
                      act("settings.update", { calendarOverrides: copy }).catch(
                        () => {},
                      );
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
          </div>
        </section>
        <section className="surface-card settings-card">
          <div className="card-heading">
            <h3>数据与备份</h3>
            <Save size={18} />
          </div>
          <p>项目数据保存在这台电脑。建议在重要调整前导出一份备份。</p>
          <div className="settings-actions">
            <a className="btn primary" href="/api/export" download>
              <Download size={16} />
              导出全部数据
            </a>
            <button
              className="btn"
              onClick={() =>
                act("backup.create")
                  .then(() => notify("备份已写入项目 backups 文件夹"))
                  .catch(() => {})
              }
            >
              <Save size={16} />
              本机备份
            </button>
            <button className="btn" onClick={() => importRef.current?.click()}>
              <Upload size={16} />
              从备份恢复
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const data = JSON.parse(await f.text());
                  ask(
                    "从备份恢复",
                    `将用「${f.name}」中的数据替换当前工作台。恢复前会自动备份当前数据。`,
                    () => act("state.import", { state: data.state || data }),
                    true,
                  );
                } catch {
                  notify("无法读取这份 JSON 备份");
                }
                e.target.value = "";
              }}
            />
          </div>
          <p className="field-hint">
            恢复包含项目、目标、任务、里程碑与全局设置。
          </p>
        </section>
        <section className="surface-card settings-card">
          <div className="card-heading">
            <h3>AI 工具协作</h3>
            <Command size={18} />
          </div>
          <p>
            通过本机 MCP 工具，可让支持它的 AI
            客户端读取安排、添加任务、调整日期。
          </p>
          <div className="integration-line">
            <i className="status-light" />
            <strong>本机 MCP 接口</strong>
            <span className="badge">已提供 · 未连接客户端</span>
          </div>
          <p className="field-hint">
            工具和网页共用同一份数据。接入配置见项目
            docs/MCP.md；本应用不会自动发送项目资料给外部 AI。
          </p>
          <div className="setting-divider" />
          <p className="credits">
            视觉参考《明日方舟：终末地》。角色图源：
            <a
              href="https://www.taptap.cn/moment/857006468283501226"
              target="_blank"
              rel="noreferrer"
            >
              官方表情包 #10
            </a>{" "}
            · © HYPERGRYPH。
            <br />
            农历与节假日：Chinese Days。字体：HarmonyOS Sans SC。
            <br />
            Copyright 2021 Huawei Device Co., Ltd.
          </p>
        </section>
      </div>
    </div>
  );
}
