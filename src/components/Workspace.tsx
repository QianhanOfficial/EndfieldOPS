import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Diamond,
  Edit3,
  FileText,
  GripHorizontal,
  Layers3,
  ListChecks,
  Plus,
  Save,
  Trash2,
  Users,
  X,
  CalendarDays,
  ArrowUpRight,
  CheckCheck,
  MoreHorizontal,
} from "lucide-react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useApp } from "../store";
import type { Project, Task, Requirement, Subtask, Difficulty } from "../types";
import "./workspace.css";

type View = "day" | "requirements" | "tasks" | "milestones" | "background";
type Props = {
  project: Project;
  view: View;
  date: string;
  onView: (v: string) => void;
  onDate: (date: string) => void;
};
type EditKind = "task" | "requirement" | "milestone" | "batch";
type EditorState = {
  kind: EditKind;
  id?: string;
  batchId?: string;
  requirementId?: string;
  title?: string;
  description?: string;
  date?: string;
  difficulty?: Difficulty;
  workers?: string[];
  subtasks?: Subtask[];
  dependencies?: string[];
  requirementKind?: Requirement["kind"];
  updatedAt?: string;
};
const difficultyLabels: Record<Difficulty, string> = {
  normal: "一般",
  medium: "中等",
  hard: "高难",
};
const kindLabels = { new: "新增", improve: "改进", retire: "废弃" };
const weekDays = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];
const sortItems = <T extends { order: number; createdAt: string }>(
  items: T[],
) =>
  [...items].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  );
function formatDate(date: string, format: string) {
  if (!date) return "未安排日期";
  if (format === "MM/DD") return date.slice(5).replace("-", "/");
  return format === "YYYY-MM-DD" ? date : date.replaceAll("-", ".");
}
function dayDistance(a: string, b: string) {
  return Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000,
  );
}
function uid() {
  return (
    globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
  );
}
function onError(error: unknown, notify: (v: string) => void) {
  notify(error instanceof Error ? error.message : "保存失败，请重试");
}

function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    const timer = window.setTimeout(
      () =>
        (
          element?.querySelector<HTMLElement>("input,textarea,select") ||
          element?.querySelector<HTMLElement>("button")
        )?.focus(),
      10,
    );
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab" && element) {
        const fields = [
          ...element.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',
          ),
        ].filter((field) => field.getClientRects().length > 0);
        const first = fields[0],
          last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="ws-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`ws-dialog ${wide ? "ws-dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="ws-dialog-heading">
          <h2>{title}</h2>
          <button
            className="ws-icon-button"
            aria-label="关闭对话框"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function EditDialog({
  editor,
  project,
  tasks,
  onClose,
  onSave,
}: {
  editor: EditorState;
  project: Project;
  tasks: Task[];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const { state } = useApp();
  const [title, setTitle] = useState(editor.title || "");
  const [description, setDescription] = useState(editor.description || "");
  const [date, setDate] = useState(editor.date || "");
  const [difficulty, setDifficulty] = useState<Difficulty>(
    editor.difficulty || "normal",
  );
  const [workers, setWorkers] = useState(
    editor.workers?.length ? editor.workers : [state.settings.selfName],
  );
  const [subtasks, setSubtasks] = useState<Subtask[]>(
    editor.subtasks?.map((s) => ({ ...s })) || [],
  );
  const [dependencies, setDependencies] = useState(editor.dependencies || []);
  const [kind, setKind] = useState<Requirement["kind"]>(
    editor.requirementKind || "new",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const members = [
    ...new Set([state.settings.selfName, ...project.members, ...workers]),
  ];
  const isItem = editor.kind === "task" || editor.kind === "requirement";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    const submittedDate = String(
      new FormData(event.currentTarget).get("date") ?? date,
    );
    setError("");
    if (editor.kind !== "batch" && !title.trim()) {
      setError("请填写主描述");
      return;
    }
    if (
      (editor.kind === "batch" || editor.kind === "milestone") &&
      !submittedDate
    ) {
      setError("请选择日期");
      return;
    }
    if (subtasks.some((s) => !s.title.trim())) {
      setError("请补充子任务内容，或移除空白子任务");
      return;
    }
    submitLock.current = true;
    setBusy(true);
    try {
      const cleanSubtasks = subtasks.map((sub) => ({
        ...sub,
        title: sub.title.trim(),
      }));
      const common = {
        projectId: project.id,
        title: title.trim(),
        description: description.trim(),
      };
      let payload: Record<string, unknown>;
      if (editor.kind === "batch")
        payload = { projectId: project.id, date: submittedDate };
      else if (editor.kind === "milestone")
        payload = { ...common, date: submittedDate };
      else if (editor.kind === "requirement")
        payload = {
          ...common,
          batchId: editor.batchId,
          kind,
          difficulty,
          subtasks: cleanSubtasks,
        };
      else
        payload = {
          ...common,
          date: submittedDate,
          difficulty,
          workers: workers.length ? workers : [state.settings.selfName],
          subtasks: cleanSubtasks,
          dependencies,
          ...(editor.requirementId
            ? { requirementId: editor.requirementId }
            : {}),
        };
      await onSave(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
      submitLock.current = false;
      setBusy(false);
    }
  }
  const labels = {
    task: "任务",
    requirement: "客户需求",
    milestone: "里程碑",
    batch: "需求批次",
  };
  return (
    <Dialog
      title={`${editor.id ? "编辑" : "新增"}${labels[editor.kind]}`}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={submit} className="ws-editor-form">
        <div className="ws-dialog-body">
          <fieldset disabled={busy} className="ws-editor-fields">
            {editor.kind === "requirement" && (
              <div className="ws-field">
                <span className="ws-field-label">需求类型</span>
                <div className="ws-choice-row">
                  {(Object.keys(kindLabels) as Requirement["kind"][]).map(
                    (k) => (
                      <button
                        type="button"
                        key={k}
                        onClick={() => setKind(k)}
                        className={`ws-choice ws-kind-${k} ${kind === k ? "selected" : ""}`}
                        aria-pressed={kind === k}
                      >
                        {kindLabels[k]}
                      </button>
                    ),
                  )}
                </div>
              </div>
            )}
            {editor.kind !== "batch" && (
              <>
                <label className="ws-field">
                  <span className="ws-field-label">
                    主描述 <em>*</em>
                  </span>
                  <input
                    required
                    maxLength={500}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={
                      editor.kind === "milestone"
                        ? "例如：第一版原型评审"
                        : "需要完成什么？"
                    }
                  />
                </label>
                <label className="ws-field">
                  <span className="ws-field-label">小字副描述</span>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="补充背景、交付内容或提醒（可选）"
                  />
                </label>
              </>
            )}
            {editor.kind !== "requirement" && (
              <label className="ws-field">
                <span className="ws-field-label">
                  {editor.kind === "batch"
                    ? "客户提出日期"
                    : editor.kind === "milestone"
                      ? "里程碑日期"
                      : "计划日期"}
                  {editor.kind === "task" ? (
                    <small>可留空，稍后安排</small>
                  ) : (
                    <em>*</em>
                  )}
                </span>
                <input
                  type="date"
                  min="1900-01-01"
                  max="2099-12-31"
                  name="date"
                  required={editor.kind !== "task"}
                  value={date}
                  onInput={(e) => setDate(e.currentTarget.value)}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            )}
            {isItem && (
              <div className="ws-field">
                <span className="ws-field-label">工作量</span>
                <div className="ws-choice-row">
                  {(Object.keys(difficultyLabels) as Difficulty[]).map((d) => (
                    <button
                      type="button"
                      key={d}
                      aria-pressed={difficulty === d}
                      onClick={() => setDifficulty(d)}
                      className={`ws-choice ${difficulty === d ? "selected" : ""}`}
                    >
                      {difficultyLabels[d]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {editor.kind === "task" && (
              <div className="ws-field">
                <span className="ws-field-label">
                  由谁完成 <small>可多选，默认自己</small>
                </span>
                <div className="ws-choice-row ws-worker-choices">
                  {members.map((name) => (
                    <button
                      type="button"
                      key={name}
                      className={`ws-choice ${workers.includes(name) ? "selected" : ""}`}
                      aria-pressed={workers.includes(name)}
                      onClick={() =>
                        setWorkers((w) => {
                          const next = w.includes(name)
                            ? w.filter((n) => n !== name)
                            : [...w, name];
                          return next.length ? next : [state.settings.selfName];
                        })
                      }
                    >
                      {workers.includes(name) && <Check size={13} />} {name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {isItem && (
              <div className="ws-field">
                <span className="ws-field-label">
                  子任务 <small>{subtasks.length}/20</small>
                </span>
                <div className="ws-subtask-form">
                  {subtasks.map((sub, index) => (
                    <div className="ws-subtask-edit" key={sub.id}>
                      <button
                        type="button"
                        className={`ws-check ${sub.done ? "done" : ""}`}
                        aria-label={`${sub.done ? "取消完成" : "完成"}子任务 ${index + 1}`}
                        onClick={() =>
                          setSubtasks((rows) =>
                            rows.map((s) =>
                              s.id === sub.id ? { ...s, done: !s.done } : s,
                            ),
                          )
                        }
                      >
                        {sub.done && <Check size={13} />}
                      </button>
                      <input
                        value={sub.title}
                        aria-label={`子任务 ${index + 1}`}
                        placeholder={`子任务 ${index + 1}`}
                        maxLength={500}
                        onChange={(e) =>
                          setSubtasks((rows) =>
                            rows.map((s) =>
                              s.id === sub.id
                                ? { ...s, title: e.target.value }
                                : s,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="ws-icon-button"
                        aria-label={`移除子任务 ${index + 1}`}
                        onClick={() =>
                          setSubtasks((rows) =>
                            rows.filter((s) => s.id !== sub.id),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="ws-text-button"
                  disabled={subtasks.length >= 20}
                  onClick={() =>
                    setSubtasks((rows) => [
                      ...rows,
                      { id: uid(), title: "", done: false },
                    ])
                  }
                >
                  <Plus size={14} />
                  添加子任务
                </button>
              </div>
            )}
            {editor.kind === "task" &&
              tasks.some((t) => t.id !== editor.id) && (
                <details className="ws-dependencies">
                  <summary>
                    前置任务{" "}
                    <span>
                      {dependencies.length
                        ? `已选 ${dependencies.length} 项`
                        : "可选"}
                    </span>
                  </summary>
                  <p>需要先完成哪些任务？系统会检查循环依赖。</p>
                  <div className="ws-dependency-list">
                    {tasks
                      .filter((t) => t.id !== editor.id)
                      .map((t) => (
                        <label key={t.id}>
                          <input
                            type="checkbox"
                            checked={dependencies.includes(t.id)}
                            onChange={(e) =>
                              setDependencies((ids) =>
                                e.target.checked
                                  ? [...ids, t.id]
                                  : ids.filter((id) => id !== t.id),
                              )
                            }
                          />
                          <span>{t.title}</span>
                          {t.done && <Check size={13} />}
                        </label>
                      ))}
                  </div>
                </details>
              )}
            {editor.kind === "batch" && (
              <p className="ws-help">
                按沟通次数保留需求。创建后可添加「新增 / 改进 / 废弃」条目。
              </p>
            )}
            {error && (
              <p className="ws-form-error" role="alert">
                {error}
              </p>
            )}
          </fieldset>
        </div>
        <div className="ws-dialog-footer">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            <Save size={15} />
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Empty({
  icon,
  children,
  detail,
  action,
}: {
  icon: ReactNode;
  children: ReactNode;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="ws-empty">
      <div className="ws-empty-icon">{icon}</div>
      <h3>{children}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function TodoRow({
  item,
  selected,
  selecting,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  onDrop,
  draggable = true,
  kind,
  selfName,
  onCreateTask,
  onSubtask,
}: {
  item: Task | Requirement;
  selected: boolean;
  selecting: boolean;
  onSelect: () => void;
  onToggle: () => Promise<unknown>;
  onEdit: () => void;
  onDelete: () => void;
  onDrop?: (id: string) => void;
  draggable?: boolean;
  kind: "task" | "requirement";
  selfName: string;
  onCreateTask?: () => void;
  onSubtask: (subtasks: Subtask[]) => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [over, setOver] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntil = useRef(0);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const mutationLock = useRef(false);
  const [mutating, setMutating] = useState(false);
  async function mutate(change: () => Promise<unknown>) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setMutating(true);
    try {
      await change();
    } finally {
      mutationLock.current = false;
      setMutating(false);
    }
  }
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };
  useEffect(() => () => cancelPress(), []);
  const workers = "workers" in item ? item.workers : [];
  const showWorkers =
    workers.length > 0 && !(workers.length === 1 && workers[0] === selfName);
  return (
    <div
      className={`ws-todo ${item.done ? "is-done" : ""} ${selected ? "is-selected" : ""} ${over ? "is-over" : ""}`}
      onDragOver={(e) => {
        if (onDrop && e.dataTransfer.types.includes("text/eops-task")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onClickCapture={(e) => {
        if (e.detail !== 0 && Date.now() < suppressClickUntil.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClickUntil.current = 0;
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        suppressClickUntil.current = Date.now() + 800;
        const id = e.dataTransfer.getData("text/eops-task");
        if (id && id !== item.id) onDrop?.(id);
      }}
    >
      <div
        className="ws-todo-main"
        onPointerDown={(e) => {
          cancelPress();
          suppressClickUntil.current = 0;
          if (e.button !== 0 || !e.isPrimary) return;
          const control = (e.target as HTMLElement).closest("button,input,a");
          if (control && !control.classList.contains("ws-todo-content")) return;
          pressOrigin.current = { x: e.clientX, y: e.clientY };
          press.current = setTimeout(() => {
            suppressClickUntil.current = Date.now() + 800;
            onSelect();
          }, 550);
        }}
        onPointerMove={(e) => {
          if (
            pressOrigin.current &&
            Math.hypot(
              e.clientX - pressOrigin.current.x,
              e.clientY - pressOrigin.current.y,
            ) > 8
          )
            cancelPress();
        }}
        onPointerUp={() => {
          cancelPress();
          if (suppressClickUntil.current)
            suppressClickUntil.current = Date.now() + 800;
        }}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => {
          if (Date.now() < suppressClickUntil.current) e.preventDefault();
        }}
      >
        {selecting && (
          <button
            className={`ws-select-check ${selected ? "selected" : ""}`}
            aria-label={`选择 ${item.title}`}
            aria-pressed={selected}
            onClick={onSelect}
          >
            {selected && <Check size={12} />}
          </button>
        )}
        <button
          type="button"
          className={`ws-check ${item.done ? "done" : ""}`}
          aria-label={`${item.done ? "取消完成" : "完成"} ${item.title}`}
          aria-pressed={item.done}
          disabled={mutating}
          onClick={() => void mutate(onToggle)}
        >
          {item.done && <Check size={14} />}
        </button>
        <button
          className="ws-todo-content"
          disabled={mutating}
          onClick={() => {
            selecting ? onSelect() : onEdit();
          }}
        >
          <span className="ws-todo-title">{item.title}</span>
          {item.description && (
            <span className="ws-todo-desc">{item.description}</span>
          )}
          <span className="ws-todo-meta">
            {kind === "requirement" && (
              <span
                className={`ws-kind-pill ws-kind-${(item as Requirement).kind}`}
              >
                {kindLabels[(item as Requirement).kind]}
              </span>
            )}
            {item.difficulty !== "normal" && (
              <span className={`ws-difficulty ${item.difficulty}`}>
                {difficultyLabels[item.difficulty]}
              </span>
            )}
            {showWorkers && (
              <span className="ws-workers">
                <Users size={11} />
                工作者：{workers.join("、")}
              </span>
            )}
            {"dependencies" in item && item.dependencies.length > 0 && (
              <span>前置 {item.dependencies.length} 项</span>
            )}
          </span>
        </button>
        <div className="ws-row-tools">
          <button
            className="ws-icon-button ws-more"
            aria-label={`${item.title} 更多操作`}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={17} />
          </button>
          {draggable && (
            <button
              className="ws-grip"
              draggable
              title="拖动调整顺序"
              aria-label={`拖动 ${item.title} 调整顺序`}
              onDragStart={(e) => {
                suppressClickUntil.current = Date.now() + 800;
                e.dataTransfer.setData("text/eops-task", item.id);
                e.dataTransfer.effectAllowed = "move";
                cancelPress();
              }}
              onDragEnd={() => {
                suppressClickUntil.current = Date.now() + 800;
                setOver(false);
                cancelPress();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <GripHorizontal size={17} />
            </button>
          )}
        </div>
      </div>
      {menu && (
        <div className="ws-item-menu">
          <button
            onClick={() => {
              setMenu(false);
              onEdit();
            }}
          >
            <Edit3 size={13} />
            编辑
          </button>
          {onCreateTask && (
            <button
              onClick={() => {
                setMenu(false);
                onCreateTask();
              }}
            >
              <ArrowUpRight size={13} />
              安排为任务
            </button>
          )}
          <button
            onClick={() => {
              setMenu(false);
              onSelect();
            }}
          >
            <CheckCheck size={13} />
            选择
          </button>
          <button
            className="danger"
            onClick={() => {
              setMenu(false);
              onDelete();
            }}
          >
            <Trash2 size={13} />
            删除
          </button>
        </div>
      )}
      {item.subtasks.length > 0 && (
        <div className="ws-subtasks">
          <button
            className="ws-subtask-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            子任务{" "}
            <span>
              {item.subtasks.filter((s) => s.done).length}/
              {item.subtasks.length}
            </span>
          </button>
          {expanded && (
            <div className="ws-subtask-rows">
              {item.subtasks.map((sub) => (
                <button
                  key={sub.id}
                  className={`ws-subtask-row ${sub.done ? "done" : ""}`}
                  disabled={mutating}
                  aria-pressed={sub.done}
                  onClick={() =>
                    void mutate(() =>
                      onSubtask(
                        item.subtasks.map((s) =>
                          s.id === sub.id ? { ...s, done: !s.done } : s,
                        ),
                      ),
                    )
                  }
                >
                  <span className={`ws-check ${sub.done ? "done" : ""}`}>
                    {sub.done && <Check size={11} />}
                  </span>
                  <span>{sub.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Keep the legacy sessionStorage key so unsaved personal drafts survive the rename.
function readBackgroundDraft(project: Project) {
  try {
    const cached = sessionStorage.getItem(
      `dayline:background-draft:${project.id}`,
    );
    if (cached) {
      const parsed = JSON.parse(cached);
      if (typeof parsed.text === "string" && typeof parsed.base === "string")
        return { text: parsed.text, base: parsed.base, available: true };
    }
    return {
      text: project.description,
      base: project.description,
      available: true,
    };
  } catch {
    return {
      text: project.description,
      base: project.description,
      available: false,
    };
  }
}

function BackgroundEditor({ project }: { project: Project }) {
  const { act, notify } = useApp();
  const initial = useRef(readBackgroundDraft(project));
  const [draft, setDraft] = useState(initial.current.text);
  const [base, setBase] = useState(initial.current.base);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [cacheOkay, setCacheOkay] = useState(initial.current.available);
  const saveLock = useRef(false);
  const dirty = draft !== project.description;
  const conflict = dirty && base !== project.description;
  useEffect(() => {
    if (draft === project.description) {
      if (base !== project.description) setBase(project.description);
    } else if (draft === base) {
      setDraft(project.description);
      setBase(project.description);
    }
  }, [project.description, base, draft]);
  useEffect(() => {
    try {
      const key = `dayline:background-draft:${project.id}`;
      if (dirty)
        sessionStorage.setItem(key, JSON.stringify({ text: draft, base }));
      else sessionStorage.removeItem(key);
      setCacheOkay(true);
    } catch {
      setCacheOkay(false);
    }
  }, [draft, base, dirty, project.id]);
  async function save(force = false) {
    if (saveLock.current) return;
    if (conflict && !force) {
      setConfirmOverwrite(true);
      return;
    }
    saveLock.current = true;
    setSaving(true);
    const submitted = draft;
    try {
      await act("project.update", { id: project.id, description: submitted });
      setBase(submitted);
      setDraft(submitted);
      setConfirmOverwrite(false);
      notify("项目背景已保存");
    } catch (e) {
      onError(e, notify);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="ws-background">
      <div className="ws-background-toolbar">
        <div className="ws-filters">
          <button
            className={!preview ? "active" : ""}
            onClick={() => setPreview(false)}
          >
            <Edit3 size={13} />
            编辑
          </button>
          <button
            className={preview ? "active" : ""}
            onClick={() => setPreview(true)}
          >
            <FileText size={13} />
            预览
          </button>
        </div>
        <button
          className="btn primary"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          <Save size={14} />
          {saving ? "保存中…" : "保存背景"}
        </button>
      </div>
      <p className="ws-help">
        支持 Markdown 标题、列表、链接和表格。编辑后点击保存。
      </p>
      {conflict && (
        <div className="ws-draft-conflict" role="status">
          <span>已保存版本有更新，你正在编辑的草稿已保留。</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDraft(project.description);
              setBase(project.description);
            }}
          >
            采用已保存版本
          </button>
        </div>
      )}
      {preview ? (
        <article
          className="ws-markdown"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(
              marked.parse(draft || "*还没有项目背景，切换到编辑开始记录。*", {
                async: false,
              }) as string,
            ),
          }}
        />
      ) : (
        <textarea
          className="ws-markdown-editor"
          disabled={saving}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            "# 项目背景\n\n这个项目要解决什么问题？\n\n## 目标\n- \n\n## 当前认识\n"
          }
          aria-label="项目背景 Markdown 编辑器"
        />
      )}
      <div className="ws-editor-status">
        <span>Markdown</span>
        <span>
          {!dirty
            ? "已保存"
            : cacheOkay
              ? "草稿已暂存 · 保存后生效"
              : "有未保存内容"}{" "}
          · {draft.length} 字符
        </span>
      </div>
      {confirmOverwrite && (
        <Dialog
          title="保存项目背景"
          onClose={() => {
            if (!saving) setConfirmOverwrite(false);
          }}
        >
          <div className="ws-dialog-body">
            <p className="ws-delete-message">
              项目背景已在其他窗口或工具中更新。
            </p>
            <p className="ws-help">
              保存将用当前草稿替换已保存版本。取消可继续编辑，或采用最新已保存内容。
            </p>
          </div>
          <div className="ws-dialog-footer">
            <button
              className="btn ghost"
              disabled={saving}
              onClick={() => setConfirmOverwrite(false)}
            >
              取消
            </button>
            <button
              className="btn primary"
              disabled={saving}
              onClick={() => void save(true)}
            >
              {saving ? "保存中…" : "保存我的版本"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export default function Workspace({ project, view, date, onDate }: Props) {
  const { state, act, notify } = useApp();
  const pageRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const page = pageRef.current;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!page || state.settings.reducedMotion || motion.matches) return;

    // Animate in place without remounting the workspace for a visual transition.
    const transition = page.animate(
      [
        { opacity: 0.35, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    const stopForReducedMotion = () => {
      if (motion.matches) transition.cancel();
    };
    motion.addEventListener("change", stopForReducedMotion);
    return () => {
      transition.cancel();
      motion.removeEventListener("change", stopForReducedMotion);
    };
  }, [view, project.id, state.settings.reducedMotion]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: string;
    ids: string[];
    label: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [bulkDate, setBulkDate] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const taskItems = useMemo(
    () => sortItems(state.tasks.filter((t) => t.projectId === project.id)),
    [state.tasks, project.id],
  );
  const reqItems = useMemo(
    () =>
      sortItems(state.requirements.filter((t) => t.projectId === project.id)),
    [state.requirements, project.id],
  );
  const batches = useMemo(
    () =>
      state.batches
        .filter((b) => b.projectId === project.id)
        .sort((a, b) => a.sequence - b.sequence),
    [state.batches, project.id],
  );
  const milestones = useMemo(
    () =>
      [...state.milestones]
        .filter((m) => m.projectId === project.id)
        .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order),
    [state.milestones, project.id],
  );
  const fmt = (d: string) => formatDate(d, state.settings.dateFormat);
  const isTaskView = view === "day" || view === "tasks";
  const selectedItems = (view === "requirements" ? reqItems : taskItems).filter(
    (t) => selection.includes(t.id),
  );
  const matchesFilter = (t: { done: boolean }) =>
    filter === "all" || (filter === "done" ? t.done : !t.done);
  const dayTasks = taskItems.filter((t) => t.date === date);
  const visibleTasks = (view === "day" ? dayTasks : taskItems).filter(
    matchesFilter,
  );
  const dates = [...new Set(visibleTasks.map((t) => t.date))].sort((a, b) =>
    !a ? 1 : !b ? -1 : a.localeCompare(b),
  );
  useEffect(() => {
    setSelection([]);
    setSelectMode(false);
    setEditor(null);
    setFilter("all");
  }, [view, project.id, date]);
  async function action(type: string, payload: Record<string, unknown>) {
    try {
      return await act(type, payload);
    } catch (e) {
      onError(e, notify);
      return undefined;
    }
  }
  function select(id: string) {
    setSelectMode(true);
    setSelection((ids) =>
      ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id],
    );
  }
  function editTask(t: Task) {
    setEditor({ kind: "task", ...t });
  }
  function editReq(r: Requirement) {
    setEditor({ ...r, kind: "requirement", requirementKind: r.kind });
  }
  function newTask(d = date) {
    setEditor({ kind: "task", date: d });
  }
  async function saveEditor(payload: Record<string, unknown>) {
    if (!editor) return;
    if (editor.id && editor.updatedAt) {
      const collection =
        editor.kind === "task"
          ? state.tasks
          : editor.kind === "requirement"
            ? state.requirements
            : editor.kind === "milestone"
              ? state.milestones
              : state.batches;
      const current = collection.find((item) => item.id === editor.id);
      if (!current) throw new Error("这个条目已被删除，当前填写内容仍保留。");
      if (current.updatedAt !== editor.updatedAt)
        throw new Error(
          "这个条目已在其他窗口或工具中更新。为避免覆盖，请保留当前文字，关闭后重新打开编辑。",
        );
    }
    const updated = await act(
      `${editor.kind}.${editor.id ? "update" : "create"}`,
      { ...payload, ...(editor.id ? { id: editor.id } : {}) },
    );
    if (editor.kind === "batch" && !editor.id) {
      const latest = updated.batches
        .filter((b) => b.projectId === project.id)
        .sort((a, b) => b.sequence - a.sequence)[0];
      setEditor(latest ? { kind: "requirement", batchId: latest.id } : null);
    } else setEditor(null);
    notify("已保存");
  }
  async function reorder(
    sourceId: string,
    targetId: string,
    items: (Task | Requirement)[],
    kind: string,
  ) {
    const from = items.findIndex((t) => t.id === sourceId),
      to = items.findIndex((t) => t.id === targetId);
    if (from < 0 || to < 0) return;
    const ids = items.map((t) => t.id);
    ids.splice(to, 0, ...ids.splice(from, 1));
    await action(`${kind}.reorder`, { ids });
  }
  async function bulkDone(done: boolean) {
    setBulkBusy(true);
    try {
      for (const id of selection)
        await act(
          `${view === "requirements" ? "requirement" : "task"}.update`,
          { id, done },
        );
      setSelection([]);
      setSelectMode(false);
      notify(done ? "已标记完成" : "已恢复待办");
    } catch (e) {
      onError(e, notify);
    } finally {
      setBulkBusy(false);
    }
  }
  async function applyBulkDate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bulkDate === null || bulkBusy) return;
    const submittedDate = String(
      new FormData(event.currentTarget).get("date") ?? bulkDate,
    );
    setBulkBusy(true);
    try {
      for (const id of selection)
        await act("task.update", { id, date: submittedDate });
      setBulkDate(null);
      setSelection([]);
      setSelectMode(false);
      notify("已调整任务日期");
    } catch (e) {
      onError(e, notify);
    } finally {
      setBulkBusy(false);
    }
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      for (const id of deleteTarget.ids)
        await act(`${deleteTarget.kind}.delete`, { id });
      setSelection((ids) => ids.filter((id) => !deleteTarget.ids.includes(id)));
      setDeleteTarget(null);
      notify("已删除");
    } catch (e) {
      onError(e, notify);
    } finally {
      setDeleteBusy(false);
    }
  }
  function renderTodo(
    item: Task | Requirement,
    kind: "task" | "requirement",
    group: (Task | Requirement)[],
  ) {
    return (
      <TodoRow
        key={item.id}
        item={item}
        kind={kind}
        selected={selection.includes(item.id)}
        selecting={selectMode}
        selfName={state.settings.selfName}
        onSelect={() => select(item.id)}
        onEdit={() =>
          kind === "task"
            ? editTask(item as Task)
            : editReq(item as Requirement)
        }
        onToggle={() =>
          action(`${kind}.update`, { id: item.id, done: !item.done })
        }
        onSubtask={(subtasks) =>
          action(`${kind}.update`, { id: item.id, subtasks })
        }
        onDelete={() =>
          setDeleteTarget({ kind, ids: [item.id], label: item.title })
        }
        onDrop={(sourceId) => {
          void reorder(sourceId, item.id, group, kind);
        }}
        onCreateTask={
          kind === "requirement"
            ? () => {
                setEditor({
                  kind: "task",
                  requirementId: item.id,
                  title: item.title,
                  description: item.description,
                  difficulty: item.difficulty,
                  subtasks: item.subtasks.map((s) => ({
                    ...s,
                    id: uid(),
                    done: false,
                  })),
                  date,
                });
              }
            : undefined
        }
      />
    );
  }
  const dayDone = dayTasks.filter((t) => t.done).length;
  const titles = {
    day: "当日任务",
    requirements: "客户需求",
    tasks: "任务管理",
    milestones: "里程碑管理",
    background: "项目背景",
  };
  return (
    <section
      ref={pageRef}
      className={`ws-editor ws-view-${view}`}
      aria-label={titles[view]}
    >
      <header className="ws-page-heading">
        <div>
          <h1>
            {titles[view]}
            {view === "day" && (
              <span className="ws-heading-date">{fmt(date)}</span>
            )}
          </h1>
        </div>
        <div className="ws-heading-actions">
          {(isTaskView || view === "requirements") && (
            <button
              className={`btn ghost ws-select-toggle ${selectMode ? "active" : ""}`}
              onClick={() => {
                setSelectMode(!selectMode);
                setSelection([]);
              }}
            >
              <CheckCheck size={15} />
              {selectMode ? "取消选择" : "选择"}
            </button>
          )}
          {view === "requirements" && (
            <button
              className="btn primary"
              onClick={() => setEditor({ kind: "batch", date })}
            >
              <Plus size={15} />
              新一批
            </button>
          )}
          {view === "tasks" && (
            <button className="btn primary" onClick={() => newTask("")}>
              <Plus size={15} />
              新建任务
            </button>
          )}
          {view === "milestones" && (
            <button
              className="btn primary"
              onClick={() => setEditor({ kind: "milestone", date })}
            >
              <Plus size={15} />
              新建
            </button>
          )}
        </div>
      </header>
      {view === "day" && (
        <div className="ws-day-summary">
          <span>
            <b>{String(dayDone).padStart(2, "0")}</b>
            <i>/</i>
            {String(dayTasks.length).padStart(2, "0")} <small>已完成</small>
          </span>
          <div
            className="ws-day-progress"
            aria-label={`任务完成率 ${dayTasks.length ? Math.round((dayDone / dayTasks.length) * 100) : 100}%`}
          >
            <span
              style={{
                width: `${dayTasks.length ? (dayDone / dayTasks.length) * 100 : 100}%`,
              }}
            />
          </div>
          <span className="ws-day-week">
            {weekDays[new Date(date + "T12:00:00").getDay()]}
          </span>
        </div>
      )}
      {(isTaskView || view === "requirements") && (
        <div className="ws-list-toolbar">
          <div className="ws-filters">
            {(["all", "open", "done"] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "全部" : f === "open" ? "待完成" : "已完成"}
              </button>
            ))}
          </div>
          <span className="ws-count">
            {view === "requirements"
              ? reqItems.filter(matchesFilter).length
              : visibleTasks.length}{" "}
            项
          </span>
        </div>
      )}
      {selectMode && (
        <div className="ws-selection-bar">
          <button
            className="ws-text-button"
            onClick={() =>
              setSelection(
                view === "requirements"
                  ? reqItems.filter(matchesFilter).map((r) => r.id)
                  : visibleTasks.map((t) => t.id),
              )
            }
          >
            全选
          </button>
          <span>已选 {selection.length}</span>
          <div className="ws-bulk-actions">
            <button
              disabled={!selection.length || bulkBusy}
              title="标记完成"
              onClick={() => void bulkDone(true)}
            >
              <Check size={15} />
              <span>完成</span>
            </button>
            {selectedItems.some((t) => t.done) && (
              <button disabled={bulkBusy} onClick={() => void bulkDone(false)}>
                恢复
              </button>
            )}
            {isTaskView && (
              <button
                disabled={!selection.length || bulkBusy}
                title="调整日期"
                onClick={() => setBulkDate(date)}
              >
                <CalendarDays size={15} />
                <span>移期</span>
              </button>
            )}
            <button
              disabled={!selection.length || bulkBusy}
              className="danger"
              title="删除选中条目"
              onClick={() =>
                setDeleteTarget({
                  kind: view === "requirements" ? "requirement" : "task",
                  ids: [...selection],
                  label: `选中的 ${selection.length} 个条目`,
                })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      )}
      <div className="ws-content">
        {view === "day" &&
          (visibleTasks.length ? (
            <div className="ws-todo-list">
              {visibleTasks.map((t) => renderTodo(t, "task", dayTasks))}
            </div>
          ) : (
            <Empty
              icon={<ListChecks size={28} />}
              detail={
                dayTasks.length
                  ? "切换筛选条件查看其他任务。"
                  : "点击加号添加当天任务。"
              }
              action={
                !dayTasks.length && (
                  <button className="btn ghost" onClick={() => newTask()}>
                    <Plus size={15} />
                    添加第一条任务
                  </button>
                )
              }
            >
              {dayTasks.length
                ? "这里暂时没有任务"
                : "这一天还没有安排 ( ˙▿˙ )"}
            </Empty>
          ))}
        {view === "tasks" &&
          (dates.length ? (
            dates.map((d) => (
              <div className="ws-group" key={d || "unscheduled"}>
                <div className="ws-group-heading">
                  <button
                    onClick={() => {
                      if (d) onDate(d);
                    }}
                    disabled={!d}
                  >
                    <CalendarDays size={14} />
                    <h2>{fmt(d)}</h2>
                  </button>
                  <span>
                    {visibleTasks.filter((t) => t.date === d).length} 项
                  </span>
                  <button
                    className="ws-icon-button"
                    aria-label={`在 ${fmt(d)} 添加任务`}
                    onClick={() => newTask(d)}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <div className="ws-todo-list">
                  {visibleTasks
                    .filter((t) => t.date === d)
                    .map((t) =>
                      renderTodo(
                        t,
                        "task",
                        taskItems.filter((t) => t.date === d),
                      ),
                    )}
                </div>
              </div>
            ))
          ) : (
            <Empty
              icon={<ListChecks size={28} />}
              detail="创建任务并安排日期，也可先保留为未安排。"
              action={
                <button className="btn ghost" onClick={() => newTask("")}>
                  <Plus size={15} />
                  添加任务
                </button>
              }
            >
              暂无任务
            </Empty>
          ))}
        {view === "requirements" &&
          (batches.length ? (
            batches.map((batch) => {
              const batchItems = reqItems.filter((r) => r.batchId === batch.id);
              const items = batchItems.filter(matchesFilter);
              return (
                <div className="ws-group ws-batch" key={batch.id}>
                  <div className="ws-group-heading">
                    <span className="ws-batch-index">
                      {String(batch.sequence).padStart(2, "0")}
                    </span>
                    <h2>
                      客户第 {batch.sequence} 次需求
                      <span>{fmt(batch.date)}</span>
                    </h2>
                    <div className="ws-group-tools">
                      <button
                        className="ws-icon-button"
                        aria-label={`编辑第 ${batch.sequence} 次需求日期`}
                        onClick={() =>
                          setEditor({
                            kind: "batch",
                            id: batch.id,
                            date: batch.date,
                            updatedAt: batch.updatedAt,
                          })
                        }
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        className="ws-icon-button"
                        aria-label={`删除第 ${batch.sequence} 次需求批次`}
                        onClick={() =>
                          setDeleteTarget({
                            kind: "batch",
                            ids: [batch.id],
                            label: `第 ${batch.sequence} 次需求及其 ${batchItems.length} 个条目`,
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        className="ws-icon-button"
                        aria-label={`为第 ${batch.sequence} 次需求添加条目`}
                        onClick={() =>
                          setEditor({ kind: "requirement", batchId: batch.id })
                        }
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="ws-todo-list">
                    {items.map((r) => renderTodo(r, "requirement", batchItems))}
                  </div>
                  {!items.length && (
                    <button
                      className="ws-inline-empty"
                      onClick={() =>
                        setEditor({ kind: "requirement", batchId: batch.id })
                      }
                    >
                      <Plus size={14} />
                      {batchItems.length
                        ? "此筛选下没有条目 · 添加需求"
                        : "添加这一批客户需求"}
                    </button>
                  )}
                </div>
              );
            })
          ) : (
            <Empty
              icon={<Layers3 size={28} />}
              detail="按每次沟通分组，记录新增、改进、废弃条目。"
              action={
                <button
                  className="btn ghost"
                  onClick={() => setEditor({ kind: "batch", date })}
                >
                  <Plus size={15} />
                  记录第一批需求
                </button>
              }
            >
              暂无客户需求
            </Empty>
          ))}
        {view === "milestones" &&
          (milestones.length ? (
            <div className="ws-milestones">
              {milestones.map((m) => {
                const week = Math.max(
                  1,
                  Math.floor(dayDistance(project.startDate, m.date) / 7) + 1,
                );
                return (
                  <article
                    key={m.id}
                    className={`ws-milestone ${m.done ? "is-done" : ""}`}
                  >
                    <div className="ws-milestone-rail">
                      <Diamond
                        size={16}
                        fill={m.done ? "currentColor" : "none"}
                      />
                      <span />
                    </div>
                    <div className="ws-milestone-content">
                      <div className="ws-milestone-date">
                        第 {week} 周 ·{" "}
                        {weekDays[new Date(m.date + "T12:00:00").getDay()]} ·{" "}
                        {fmt(m.date)}
                      </div>
                      <button
                        className="ws-milestone-title"
                        onClick={() => setEditor({ kind: "milestone", ...m })}
                      >
                        {m.title}
                      </button>
                      {m.description && <p>{m.description}</p>}
                      <div className="ws-milestone-actions">
                        <button
                          className={`ws-milestone-done ${m.done ? "done" : ""}`}
                          onClick={() =>
                            void action("milestone.update", {
                              id: m.id,
                              done: !m.done,
                            })
                          }
                        >
                          <span className={`ws-check ${m.done ? "done" : ""}`}>
                            {m.done && <Check size={12} />}
                          </span>
                          {m.done ? "已达成" : "确认达成"}
                        </button>
                        <button
                          className="ws-icon-button"
                          aria-label={`编辑 ${m.title}`}
                          onClick={() => setEditor({ kind: "milestone", ...m })}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          className="ws-icon-button"
                          aria-label={`删除 ${m.title}`}
                          onClick={() =>
                            setDeleteTarget({
                              kind: "milestone",
                              ids: [m.id],
                              label: m.title,
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty
              icon={<Diamond size={28} />}
              detail="设置日期和交付内容，达成后手动确认。"
              action={
                <button
                  className="btn ghost"
                  onClick={() => setEditor({ kind: "milestone", date })}
                >
                  <Plus size={15} />
                  添加里程碑
                </button>
              }
            >
              暂无里程碑
            </Empty>
          ))}
        {view === "background" && (
          <BackgroundEditor key={project.id} project={project} />
        )}
      </div>
      {view === "day" && (
        <button
          className="ws-add-floating"
          aria-label="新增当天任务"
          title="新增当天任务"
          onClick={() => newTask()}
        >
          <Plus size={26} />
        </button>
      )}
      {editor && (
        <EditDialog
          key={`${editor.kind}:${editor.id || "new"}:${editor.batchId || ""}`}
          editor={editor}
          project={project}
          tasks={taskItems}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}
      {deleteTarget && (
        <Dialog
          title="删除确认"
          onClose={() => {
            if (!deleteBusy) setDeleteTarget(null);
          }}
        >
          <div className="ws-dialog-body">
            <p className="ws-delete-message">删除「{deleteTarget.label}」？</p>
            <p className="ws-help">
              删除后无法撤销。
              {deleteTarget.kind === "requirement" ||
              deleteTarget.kind === "batch"
                ? "已安排的任务仍会保留。"
                : ""}
            </p>
          </div>
          <div className="ws-dialog-footer">
            <button
              className="btn ghost"
              disabled={deleteBusy}
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </button>
            <button
              className="btn ws-danger-btn"
              disabled={deleteBusy}
              onClick={() => void confirmDelete()}
            >
              <Trash2 size={14} />
              {deleteBusy ? "删除中…" : "确认删除"}
            </button>
          </div>
        </Dialog>
      )}
      {bulkDate !== null && (
        <Dialog
          title="调整任务日期"
          onClose={() => {
            if (!bulkBusy) setBulkDate(null);
          }}
        >
          <form
            className="ws-editor-form"
            onSubmit={(event) => void applyBulkDate(event)}
          >
            <div className="ws-dialog-body">
              <label className="ws-field">
                <span className="ws-field-label">
                  将 {selection.length} 个任务安排到
                </span>
                <input
                  type="date"
                  min="1900-01-01"
                  max="2099-12-31"
                  name="date"
                  value={bulkDate}
                  disabled={bulkBusy}
                  onInput={(e) => setBulkDate(e.currentTarget.value)}
                  onChange={(e) => setBulkDate(e.target.value)}
                />
              </label>
              <p className="ws-help">
                清空日期可移入「未安排日期」，稍后再排期。
              </p>
            </div>
            <div className="ws-dialog-footer">
              <button
                type="button"
                className="btn ghost"
                disabled={bulkBusy}
                onClick={() => setBulkDate(null)}
              >
                取消
              </button>
              <button type="submit" className="btn primary" disabled={bulkBusy}>
                {bulkBusy ? "调整中…" : "确认调整"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
