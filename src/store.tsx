import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AppState } from "./types";
const Context = createContext<{
  state: AppState;
  saving: boolean;
  connected: boolean;
  act: (type: string, payload?: Record<string, unknown>) => Promise<AppState>;
  notify: (m: string) => void;
  refresh: () => Promise<void>;
} | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<AppState | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(false);
  function commit(s: AppState) {
    if (!stateRef.current || s.revision >= stateRef.current.revision) {
      stateRef.current = s;
      setState(s);
    }
  }
  function notify(m: string) {
    setToast(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4200);
  }
  async function refresh() {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw Error("无法连接本机服务");
      commit(await r.json());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function act(type: string, payload: Record<string, unknown> = {}) {
    const task = queue.current
      .catch(() => {})
      .then(async () => {
        inFlight.current = true;
        setSaving(true);
        try {
          const r = await fetch("/api/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type,
              payload,
              expectedRevision: stateRef.current?.revision,
            }),
          });
          const body = await r.json();
          if (!r.ok) {
            if (r.status === 409) await refresh();
            throw Error(body.error || "保存失败，请重试");
          }
          commit(body);
          return body as AppState;
        } catch (e) {
          notify((e as Error).message);
          throw e;
        } finally {
          inFlight.current = false;
          setSaving(false);
        }
      });
    queue.current = task;
    return task;
  }
  useEffect(() => {
    refresh();
    const tick = setInterval(() => {
      if (!document.hidden && !inFlight.current) refresh();
    }, 5000);
    const f = () => refresh();
    window.addEventListener("focus", f);
    return () => {
      clearInterval(tick);
      window.removeEventListener("focus", f);
    };
  }, []);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.style.setProperty(
      "--base-size",
      `${state.settings.fontSize}px`,
    );
    document.documentElement.dataset.motion = state.settings.reducedMotion
      ? "reduced"
      : "full";
  }, [state?.settings]);
  if (!state)
    return (
      <div className="boot">
        <img className="endfield-logo" src="/assets/eops-logo-black.svg" alt="EOPS 终末地工业项目中枢" />
        <h1>EOPS 终末地工业项目中枢</h1>
        <p>{error || "正在打开你的工作台…"}</p>
        {error && (
          <button className="btn" onClick={() => refresh()}>
            重新连接
          </button>
        )}
      </div>
    );
  return (
    <Context.Provider
      value={{ state, saving, connected: !error, act, notify, refresh }}
    >
      {children}
      {error && (
        <div className="offline">本机服务连接中断 · 更改保存前请重连</div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </Context.Provider>
  );
}
export function useApp() {
  const c = useContext(Context);
  if (!c) throw Error("AppProvider missing");
  return c;
}
export function useRoute() {
  const [loc, setLoc] = useState(
    () => window.location.pathname + window.location.search,
  );
  useEffect(() => {
    const f = () => setLoc(window.location.pathname + window.location.search);
    window.addEventListener("popstate", f);
    return () => window.removeEventListener("popstate", f);
  }, []);
  return {
    path: loc.split("?")[0],
    query: new URLSearchParams(loc.split("?")[1] || ""),
    navigate: (to: string) => {
      window.history.pushState({}, "", to);
      setLoc(to);
      window.dispatchEvent(new Event("eops:navigate"));
    },
  };
}
