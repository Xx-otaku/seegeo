import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  type FormEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileText,
  FolderOpen,
  GitCompareArrows,
  Layers3,
  ListChecks,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Power,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  ExternalLink,
  Pencil,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { diffLines } from "diff";
import { readingText } from "./reading";
import {
  platformIds,
  platformNames,
  type Platform,
  type Question,
  type Task,
  type Schedule,
  type Source,
} from "../server/types";

type Q = Question & {
  latest: {
    id: number;
    platform: Platform;
    status: string;
    finished_at: string | null;
    source_status: string | null;
    sources_count: number;
  }[];
};
type Batch = {
  id: number;
  trigger: string;
  scheduled_at: string | null;
  created_at: string;
  finished_at: string | null;
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  waiting: number;
  pending: number;
  running: number;
  cancelled: number;
  control_state: string;
  paused: number;
  parent_batch_id: number | null;
};
type State = {
  version: string;
  activeBatch: Batch | null;
  displayBatch: Batch | null;
  pausedTask: Pick<Task, "id" | "platform" | "question_text" | "phase"> | null;
  currentItem: Task | null;
  controls: Record<
    "start" | "pause" | "resume" | "cancel" | "rerun",
    { enabled: boolean; reason: string | null }
  >;
  token: string;
  paused: boolean;
  busy: boolean;
  currentTask: number | null;
  schedule: Schedule;
  nextRun: string;
  platforms: {
    id: Platform;
    name: string;
    validated: boolean;
    waiting: number;
  }[];
  batches: Batch[];
  events: { id: number; type: string; message: string; created_at: string }[];
  dataDir: string;
  allowAutoSearch: boolean;
  notifications: boolean;
};
const labels: Record<string, string> = {
  paused: "已暂停",
  pending: "排队中",
  running: "采集中",
  waiting_login: "需要登录",
  waiting_verification: "需要验证",
  uncertain: "需核对会话",
  succeeded: "已完成",
  partial: "来源待核对",
  failed: "采集失败",
  cancelled: "已取消",
};
function fmt(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      {status === "running" ? (
        <LoaderCircle size={12} className="spin" />
      ) : (
        <span className="dot" />
      )}
      {labels[status] || status}
    </span>
  );
}
let sessionToken = "";
async function api<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-Seegeo-Token": sessionToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "操作失败");
  return data;
}

const OperationContext = createContext<{ busy: boolean; state: State | null }>({
  busy: false,
  state: null,
});

export default function App() {
  const actionLock = useRef(false);
  const [state, setState] = useState<State | null>(null),
    [questions, setQuestions] = useState<Q[]>([]),
    [view, setView] = useState<
      "questions" | "records" | "compare" | "settings"
    >("questions");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [enabled, setEnabled] = useState("all");
  const [selected, setSelected] = useState<number[]>([]),
    [detail, setDetail] = useState<number | null>(null),
    [initialTask, setInitialTask] = useState<Task | null>(null),
    [initialPlatform, setInitialPlatform] = useState<Platform>("doubao"),
    [importOpen, setImportOpen] = useState(false),
    [edit, setEdit] = useState<Q | null>(null),
    [runOpen, setRunOpen] = useState(false),
    [platforms, setPlatforms] = useState<Platform[]>([...platformIds]);
  const refresh = useCallback(async () => {
    try {
      const [s, q] = await Promise.all([
        api<State>("/state"),
        api<Q[]>("/questions"),
      ]);
      sessionToken = s.token;
      setState(s);
      setQuestions(q);
      setSelected((ids) =>
        ids.filter((id) => q.some((item) => item.id === id)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const i = setInterval(() => void refresh(), 5000);
    return () => clearInterval(i);
  }, [refresh]);
  async function act(fn: () => Promise<unknown>, message = "") {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (message) setNotice(message);
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const latest = state?.batches[0];
  const filtered = questions.filter(
    (q) =>
      (q.text.toLowerCase().includes(search.toLowerCase()) ||
        q.group_name.includes(search)) &&
      (!group || q.group_name === group) &&
      (enabled === "all" || Boolean(q.enabled) === (enabled === "enabled")),
  );
  const groups = [
    ...new Set(questions.map((q) => q.group_name).filter(Boolean)),
  ];
  const navigate = (v: typeof view) => {
    setView(v);
    setDetail(null);
    setInitialTask(null);
    setEdit(null);
    setImportOpen(false);
  };
  function exportFile(format: string, query = "") {
    if (format) window.location.assign(`/api/export/${format}${query}`);
  }
  return (
    <OperationContext.Provider value={{ busy, state }}>
      <div className="app-shell">
        <aside className="sidebar">
          <a className="brand" href="/" aria-label="seegeo 首页">
            <Layers3 size={25} strokeWidth={1.7} />
            <span>
              seegeo<span className="brand-period">.</span>
            </span>
          </a>
          <div className="brand-caption">看见回答，也看见来源。</div>
          <nav aria-label="主导航">
            {(
              [
                { id: "questions", icon: ListChecks, label: "问题库" },
                { id: "records", icon: FolderOpen, label: "采集记录" },
                { id: "compare", icon: GitCompareArrows, label: "历史对照" },
                { id: "settings", icon: Settings2, label: "运行设置" },
              ] as const
            ).map((n) => (
              <button
                key={n.id}
                onClick={() => navigate(n.id)}
                className={view === n.id ? "nav-item active" : "nav-item"}
              >
                <n.icon size={19} />
                {n.label}
                {n.id === "questions" && (
                  <span className="nav-count">{questions.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-heading">
              监测平台 <span>3</span>
            </div>
            {state?.platforms.map((p) => (
              <button
                className="platform-health"
                key={p.id}
                onClick={() => navigate("settings")}
              >
                <span
                  className={`health-dot ${p.waiting ? "warn" : p.validated ? "ready" : ""}`}
                />
                <span>{p.name}</span>
                <small>
                  {p.waiting ? "待处理" : p.validated ? "已验证" : "待验证"}
                </small>
              </button>
            ))}
            <div className="local-note">
              <ShieldCheck size={14} /> 数据仅保存在本机
            </div>
            <a
              className="repo-link"
              href="https://github.com/Xx-otaku/seegeo"
              target="_blank"
              rel="noreferrer"
            >
              seegeo {state ? `v${state.version}` : "读取版本…"}{" "}
              <ExternalLink size={12} />
            </a>
          </div>
        </aside>
        <main>
          <div className="topbar">
            <span>
              个人工作区{" "}
              <span className="muted">
                /{" "}
                {view === "settings"
                  ? "运行设置"
                  : view === "records"
                    ? "采集记录"
                    : view === "compare"
                      ? "历史对照"
                      : "问题库"}
              </span>
            </span>
            <span className="service-state">
              <span className={`health-dot ${state ? "ready" : ""}`} />
              {state ? "本机服务运行中" : "正在连接服务"}
            </span>
          </div>
          <TaskToolbar
            state={state}
            busy={busy}
            selected={selected.length}
            act={act}
            onStart={() => {
              navigate("questions");
              setRunOpen(true);
            }}
          />
          {busy && (
            <div className="operation-feedback" role="status">
              <LoaderCircle size={14} className="spin" />
              正在执行操作…
            </div>
          )}
          {error && (
            <div className="message error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="关闭错误提示">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={17} />
              {notice}
            </div>
          )}
          <fieldset className="workspace" disabled={busy} aria-busy={busy}>
            {detail !== null ? (
              <Reader
                questionId={detail}
                question={questions.find((q) => q.id === detail)}
                initialTask={initialTask}
                initialPlatform={initialPlatform}
                initialTab={view === "compare" ? "history" : "read"}
                onBack={() => setDetail(null)}
                act={act}
                exportFile={exportFile}
              />
            ) : (
              <>
                <header className="page-heading">
                  <div>
                    <h1>
                      {view === "questions"
                        ? "问题监测"
                        : view === "records"
                          ? "采集记录"
                          : view === "compare"
                            ? "回答怎样变化？"
                            : "运行设置"}
                    </h1>
                    <p>
                      {view === "questions"
                        ? "用同一组问题，持续观察三个平台的回答与引用。"
                        : view === "records"
                          ? "每次采集都有记录，未完成的结果也如实保留。"
                          : view === "compare"
                            ? "选择一个问题，核对不同时点的正文与来源。"
                            : "设定采集节奏，管理独立浏览器与本机服务。"}
                    </p>
                  </div>
                  <div className="heading-actions">
                    {view === "questions" && (
                      <button
                        onClick={() => setImportOpen(!importOpen)}
                        className="button"
                      >
                        <Upload size={16} />
                        导入问题
                      </button>
                    )}
                    {view !== "settings" && (
                      <div className="export-control">
                        <ArrowDownToLine size={16} />
                        <select
                          aria-label="导出全部结果"
                          value=""
                          onChange={(e) => exportFile(e.target.value)}
                        >
                          <option value="" disabled>
                            导出结果
                          </option>
                          <option value="answers.csv">回答 CSV</option>
                          <option value="sources.csv">来源 CSV</option>
                          <option value="results.json">完整 JSON</option>
                        </select>
                      </div>
                    )}
                  </div>
                </header>
                {view === "questions" && (
                  <>
                    {runOpen && (
                      <section className="inline-panel run-config">
                        <div>
                          <h2>本轮采集范围</h2>
                          <p>
                            {selected.length
                              ? `已选择 ${selected.length} 个问题`
                              : `全部 ${questions.filter((q) => q.enabled).length} 个已启用问题`}
                            ，每题每平台一次，各自新对话。
                          </p>
                        </div>
                        <div className="check-row">
                          {platformIds.map((p) => (
                            <label key={p}>
                              <input
                                type="checkbox"
                                checked={platforms.includes(p)}
                                onChange={(e) =>
                                  setPlatforms(
                                    e.target.checked
                                      ? [...platforms, p]
                                      : platforms.filter((x) => x !== p),
                                  )
                                }
                              />
                              {platformNames[p]}
                            </label>
                          ))}
                        </div>
                        <button
                          className="button primary"
                          disabled={
                            busy ||
                            !platforms.length ||
                            !state?.controls.start.enabled ||
                            !questions.some(
                              (q) =>
                                q.enabled &&
                                (!selected.length || selected.includes(q.id)),
                            )
                          }
                          onClick={async () => {
                            if (
                              await act(
                                () =>
                                  api("/batches", {
                                    platforms,
                                    ...(selected.length
                                      ? { questionIds: selected }
                                      : {}),
                                  }),
                                "采集任务已创建",
                              )
                            )
                              setRunOpen(false);
                          }}
                        >
                          确认开始
                        </button>
                      </section>
                    )}
                    {importOpen && (
                      <ImportPanel
                        onClose={() => setImportOpen(false)}
                        act={act}
                      />
                    )}
                    <div className="section-line">
                      <div className="section-title">
                        <h2>我的问题</h2>
                        <span>
                          {questions.length} 个问题{" "}
                          <span className="divider">/</span>{" "}
                          {questions.filter((q) => q.enabled).length} 个已启用
                        </span>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => {
                          setImportOpen(true);
                          setEdit(null);
                        }}
                      >
                        <Plus size={15} /> 添加问题
                      </button>
                    </div>
                    {selected.length > 0 && (
                      <div className="selection-bar" aria-label="批量问题操作">
                        <span>
                          已选 {selected.length} 个问题
                          {selected.some(
                            (id) => !filtered.some((q) => q.id === id),
                          )
                            ? `（含当前筛选外 ${selected.filter((id) => !filtered.some((q) => q.id === id)).length} 个）`
                            : ""}
                        </span>
                        <span className="selection-help">
                          仅移出问题库，已有回答和来源保留。
                        </span>
                        <button
                          className="text-button"
                          onClick={() => setSelected([])}
                        >
                          取消选择
                        </button>
                        <button
                          className="button danger"
                          disabled={busy}
                          onClick={async () => {
                            const ids = [...selected];
                            if (
                              !window.confirm(
                                `从问题库删除所选 ${ids.length} 个问题？已有回答、来源和批次记录会保留。`,
                              )
                            )
                              return;
                            if (
                              await act(
                                () =>
                                  api("/questions/bulk-delete", {
                                    questionIds: ids,
                                  }),
                                `已删除 ${ids.length} 个问题，历史记录保留`,
                              )
                            ) {
                              setSelected([]);
                              if (edit && ids.includes(edit.id)) setEdit(null);
                            }
                          }}
                        >
                          <Trash2 size={14} />
                          删除所选（{selected.length}）
                        </button>
                      </div>
                    )}
                    <div className="filters">
                      <label className="search-box">
                        <Search size={17} />
                        <input
                          placeholder="搜索问题或分组"
                          aria-label="搜索问题或分组"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                          <button
                            onClick={() => setSearch("")}
                            aria-label="清除搜索"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </label>
                      <select
                        aria-label="问题分组"
                        value={group}
                        onChange={(e) => setGroup(e.target.value)}
                      >
                        <option value="">全部分组</option>
                        {groups.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                      <select
                        aria-label="启用状态"
                        value={enabled}
                        onChange={(e) => setEnabled(e.target.value)}
                      >
                        <option value="all">全部状态</option>
                        <option value="enabled">已启用</option>
                        <option value="disabled">未启用</option>
                      </select>
                    </div>
                    {edit && (
                      <form
                        className="inline-panel edit-panel"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (
                            await act(
                              () =>
                                api(
                                  `/questions/${edit.id}`,
                                  {
                                    text: edit.text,
                                    group_name: edit.group_name,
                                  },
                                  "PATCH",
                                ),
                              "问题已保存，历史记录保留原问题版本",
                            )
                          )
                            setEdit(null);
                        }}
                      >
                        <label>
                          问题原文
                          <textarea
                            value={edit.text}
                            onChange={(e) =>
                              setEdit({ ...edit, text: e.target.value })
                            }
                            required
                          />
                        </label>
                        <label>
                          分组
                          <input
                            value={edit.group_name}
                            onChange={(e) =>
                              setEdit({ ...edit, group_name: e.target.value })
                            }
                          />
                        </label>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="button"
                            onClick={() => setEdit(null)}
                          >
                            取消
                          </button>
                          <button className="button primary" disabled={busy}>
                            保存修改
                          </button>
                        </div>
                      </form>
                    )}
                    <div className="table-wrap">
                      <table className="questions-table">
                        <thead>
                          <tr>
                            <th className="checkbox-cell">
                              <input
                                type="checkbox"
                                aria-label="选择当前筛选的全部问题"
                                checked={
                                  filtered.length > 0 &&
                                  filtered.every((q) => selected.includes(q.id))
                                }
                                onChange={(e) =>
                                  setSelected(
                                    e.target.checked
                                      ? [
                                          ...new Set([
                                            ...selected,
                                            ...filtered.map((q) => q.id),
                                          ]),
                                        ]
                                      : selected.filter(
                                          (id) =>
                                            !filtered.some((q) => q.id === id),
                                        ),
                                  )
                                }
                              />
                            </th>
                            <th>问题 / 分组</th>
                            {platformIds.map((p) => (
                              <th key={p}>{platformNames[p]}</th>
                            ))}
                            <th>启用</th>
                            <th>
                              <span className="sr-only">操作</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((q) => (
                            <tr
                              key={q.id}
                              className={
                                selected.includes(q.id) ? "selected" : ""
                              }
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`选择问题 ${q.id}`}
                                  checked={selected.includes(q.id)}
                                  onChange={(e) =>
                                    setSelected(
                                      e.target.checked
                                        ? [...selected, q.id]
                                        : selected.filter((x) => x !== q.id),
                                    )
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  className="question-link"
                                  onClick={() => {
                                    setInitialTask(null);
                                    setInitialPlatform("doubao");
                                    setDetail(q.id);
                                  }}
                                >
                                  {q.text}
                                </button>
                                <div className="question-meta">
                                  <span>Q{String(q.id).padStart(3, "0")}</span>
                                  <span>{q.group_name || "未分组"}</span>
                                  {q.version > 1 && (
                                    <span>版本 {q.version}</span>
                                  )}
                                </div>
                              </td>
                              {platformIds.map((p) => {
                                const t = q.latest.find(
                                  (t) => t.platform === p,
                                );
                                return (
                                  <td key={p}>
                                    <button
                                      className="result-cell"
                                      onClick={() => {
                                        setInitialTask(null);
                                        setInitialPlatform(p);
                                        setDetail(q.id);
                                      }}
                                    >
                                      {t ? (
                                        <>
                                          <Badge status={t.status} />
                                          <small>{fmt(t.finished_at)}</small>
                                        </>
                                      ) : (
                                        <span className="not-collected">
                                          尚未采集
                                        </span>
                                      )}
                                    </button>
                                  </td>
                                );
                              })}
                              <td>
                                <label className="switch">
                                  <input
                                    aria-label={`启用问题 ${q.id}`}
                                    type="checkbox"
                                    checked={Boolean(q.enabled)}
                                    disabled={busy}
                                    onChange={(e) =>
                                      act(() =>
                                        api(
                                          `/questions/${q.id}`,
                                          { enabled: e.target.checked },
                                          "PATCH",
                                        ),
                                      )
                                    }
                                  />
                                  <span />
                                </label>
                              </td>
                              <td>
                                <div className="table-actions">
                                  <button
                                    title="编辑问题"
                                    aria-label={`编辑问题 ${q.id}`}
                                    onClick={() => setEdit(q)}
                                  >
                                    <Pencil size={15} />
                                  </button>
                                  <button
                                    title="移出问题库，保留历史"
                                    aria-label={`移出问题 ${q.id}`}
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          "从问题库移除此问题？已有回答和来源仍会保留。",
                                        )
                                      )
                                        void act(() =>
                                          api(
                                            `/questions/${q.id}`,
                                            undefined,
                                            "DELETE",
                                          ),
                                        );
                                    }}
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!filtered.length && (
                        <div className="empty-state">
                          <FileText size={32} strokeWidth={1.4} />
                          <h3>
                            {questions.length
                              ? "没有符合条件的问题"
                              : "先把你的问题放进来"}
                          </h3>
                          <p>
                            {questions.length
                              ? "试试清除筛选条件。"
                              : "粘贴多行问题，或导入 CSV。原文会直接发送到三个平台。"}
                          </p>
                          <button
                            className="button"
                            onClick={() =>
                              questions.length
                                ? (setSearch(""),
                                  setGroup(""),
                                  setEnabled("all"))
                                : setImportOpen(true)
                            }
                          >
                            {questions.length ? "清除筛选" : "导入第一组问题"}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="table-foot">
                      <span>
                        显示 {filtered.length} / {questions.length} 个问题
                      </span>
                      <span>每题独立对话 · 保持问题原文 · 单次采样</span>
                    </div>
                    <div className="context-note">
                      <CircleHelp size={16} />
                      <span>
                        豆包与元宝按平台规则自动联网；DeepSeek
                        开启智能搜索。是否实际搜索，会随每条结果保存。
                      </span>
                    </div>
                  </>
                )}
                {view === "records" && (
                  <Records
                    state={state}
                    onRead={(task) => {
                      setInitialTask(task);
                      setDetail(task.question_id);
                    }}
                    act={act}
                    exportFile={exportFile}
                  />
                )}
                {view === "compare" && (
                  <div className="compare-index">
                    <label>
                      选择问题
                      <select
                        aria-label="选择对照问题"
                        value=""
                        onChange={(e) => setDetail(Number(e.target.value))}
                      >
                        <option value="" disabled>
                          从问题库中选择…
                        </option>
                        {questions.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.text}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="empty-state">
                      <GitCompareArrows size={36} strokeWidth={1.4} />
                      <h3>从一条问题开始对照</h3>
                      <p>
                        查看三平台的差异，或核对同平台两次采集的正文与来源变化。
                      </p>
                    </div>
                  </div>
                )}
                {view === "settings" && state && (
                  <Settings state={state} act={act} />
                )}
              </>
            )}
          </fieldset>
          <footer className="page-footer">
            <span>seegeo · 回答与来源档案</span>
            <span>Asia/Shanghai · 数据保存在你的 Mac</span>
          </footer>
        </main>
      </div>
    </OperationContext.Provider>
  );
}

function TaskToolbar({
  state,
  busy,
  selected,
  act,
  onStart,
}: {
  state: State | null;
  busy: boolean;
  selected: number;
  act: Act;
  onStart: () => void;
}) {
  const batch = state?.displayBatch,
    active = state?.activeBatch;
  const status =
    active?.control_state ||
    (batch?.control_state === "cancelled"
      ? "cancelled"
      : batch
        ? "completed"
        : "idle");
  const names: Record<string, string> = {
    running: "正在监测",
    pausing: "正在暂停…",
    paused: "已暂停",
    waiting: "需要人工处理",
    cancelling: "正在取消…",
    cancelled: "已取消",
    completed: "本轮已结束",
    idle: "准备开始监测",
  };
  const task = state?.currentItem || state?.pausedTask;
  const completed = batch
    ? batch.succeeded + batch.partial + batch.failed + batch.cancelled
    : 0;
  const resume = status === "paused" || status === "waiting";
  const control = state?.controls[resume ? "resume" : "pause"];
  return (
    <section
      className={`task-toolbar ${active ? "has-task" : ""}`}
      aria-label="任务控制"
    >
      <div className="task-main">
        <div className={`task-indicator ${status}`} aria-hidden="true">
          {["running", "pausing", "cancelling"].includes(status) ? (
            <LoaderCircle size={18} className="spin" />
          ) : status === "paused" ? (
            <Pause size={18} />
          ) : status === "cancelled" ? (
            <X size={18} />
          ) : (
            <Clock3 size={18} />
          )}
        </div>
        <div className="task-copy">
          <div className="task-title">
            <strong>{names[status] || status}</strong>
            {batch && (
              <span>
                第 {batch.id} 轮 · {completed} / {batch.total} 项
              </span>
            )}
          </div>
          <p title={task?.question_text}>
            {task && active
              ? `${platformNames[task.platform]} · ${task.question_text}`
              : batch
                ? `${batch.succeeded} 项成功 · ${batch.partial} 项来源待核对 · ${batch.failed} 项失败${batch.cancelled ? ` · ${batch.cancelled} 项取消` : ""}`
                : state?.schedule.enabled
                  ? `下次计划 ${fmt(state.nextRun)} · 北京时间`
                  : "自动监测已关闭，可手动开始"}
          </p>
        </div>
      </div>
      <div className="task-controls">
        <button
          className="button"
          disabled={busy || !control?.enabled}
          title={
            control?.reason ||
            (resume ? "先恢复暂停问题的原会话" : "保留当前进度")
          }
          onClick={() => act(() => api(resume ? "/resume" : "/pause", {}))}
        >
          {resume ? <Play size={14} /> : <Pause size={14} />}{" "}
          {resume ? "继续监测" : "暂停监测"}
        </button>
        <button
          className="button cancel-control"
          disabled={busy || !state?.controls.cancel.enabled}
          title={state?.controls.cancel.reason || "停止本轮，保留已完成结果"}
          onClick={() =>
            act(
              () => api(`/batches/${active?.id}/cancel`, {}),
              "本轮已取消，已完成结果保留",
            )
          }
        >
          <X size={14} />
          取消监测
        </button>
        {!active && batch && (
          <button
            className="button"
            disabled={busy || !state?.controls.rerun.enabled}
            title={
              state?.controls.rerun.reason || "按本轮原问题版本和平台范围重跑"
            }
            onClick={() =>
              act(
                () => api(`/batches/${batch.id}/rerun`, {}),
                "已创建新批次，历史记录保留",
              )
            }
          >
            <RotateCcw size={14} />
            重新运行本轮
          </button>
        )}
        <button
          className="button primary"
          disabled={busy || !state?.controls.start.enabled}
          title={state?.controls.start.reason || "选择本轮问题与平台"}
          onClick={onStart}
        >
          <Plus size={15} />
          {selected ? `监测 ${selected} 个问题` : "开始一轮"}
        </button>
      </div>
      {batch && (
        <div
          className="task-progress"
          role="progressbar"
          aria-label="批次进度"
          aria-valuemin={0}
          aria-valuemax={batch.total}
          aria-valuenow={completed}
        >
          <span
            style={{
              width: `${batch.total ? (completed / batch.total) * 100 : 0}%`,
            }}
          />
        </div>
      )}
      {active && (
        <p className="task-hint">
          {status === "paused"
            ? "继续时优先恢复暂停项；取消本轮后可开始新一轮。"
            : status === "waiting"
              ? "在运行设置中完成登录或验证，再继续监测。"
              : "每题独立对话，串行采集。取消会保留已经完成的回答和来源。"}
        </p>
      )}
    </section>
  );
}

type Act = (fn: () => Promise<unknown>, message?: string) => Promise<boolean>;
function ImportPanel({ onClose, act }: { onClose: () => void; act: Act }) {
  const [content, setContent] = useState(""),
    [format, setFormat] = useState<"text" | "csv">("text"),
    [group, setGroup] = useState(""),
    [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    const okay = await act(async () => {
      const result = await api("/questions/import", { content, format, group });
      return result;
    }, "问题已导入；重复项和空行已跳过");
    setPending(false);
    if (okay) onClose();
  }
  return (
    <form className="inline-panel import-panel" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <h2>导入问题</h2>
          <p>
            纯文本每行一个问题；CSV 支持「问题」「分组」两列及带引号的多行内容。
          </p>
        </div>
        <button type="button" aria-label="关闭导入" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="import-layout">
        <label>
          问题内容
          <textarea
            rows={6}
            value={content}
            required
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              "例如：\n适合小团队的项目管理工具有哪些？\n购买便携咖啡机时应该关注什么？"
            }
          />
        </label>
        <div>
          <label>
            默认分组
            <input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="如：行业问题"
            />
          </label>
          <label>
            内容格式
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as "text" | "csv")}
            >
              <option value="text">纯文本 · 每行一题</option>
              <option value="csv">CSV · 问题、分组</option>
            </select>
          </label>
          <label className="file-input">
            <Upload size={16} /> 读取文本或 CSV 文件
            <input
              type="file"
              accept=".csv,.txt,text/plain,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setContent(await f.text());
                  setFormat(
                    f.name.toLowerCase().endsWith(".csv") ? "csv" : "text",
                  );
                }
              }}
            />
          </label>
        </div>
      </div>
      <div className="row-actions">
        <span className="muted">完整保留问题文字，导入后可编辑、启停。</span>
        <button type="button" className="button" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={pending || !content.trim()}
        >
          {pending ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Plus size={15} />
          )}
          导入问题
        </button>
      </div>
    </form>
  );
}

function Sources({
  sources,
  status,
}: {
  sources: Source[];
  status: string | null;
}) {
  return (
    <div className="sources">
      <h3>引用与来源</h3>
      {status === "failed" && (
        <p className="warning-text">
          来源提取未完成，以下内容可能不完整，请核对原会话。
        </p>
      )}
      {status === "none" && (
        <p className="muted">本次回答未展示可识别的来源。</p>
      )}
      {!status && <p className="muted">尚未完成来源采集。</p>}
      {(["citation", "search"] as const).map((kind) => {
        const list = sources.filter((s) => s.kind === kind);
        return list.length ? (
          <details key={kind} open={kind === "citation"}>
            <summary>
              {kind === "citation" ? "正文实际引用" : "平台检索参考列表"}
              <span>{list.length}</span>
            </summary>
            <ol>
              {list.map((s, i) => (
                <li key={i}>
                  <span className="source-marker">{s.marker || s.order}</span>
                  <div>
                    <a
                      href={/^https?:/.test(s.url) ? s.url : "#"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.title}
                      <ExternalLink size={12} />
                    </a>
                    <small>{s.site}</small>
                    {s.snippet && <p>{s.snippet}</p>}
                    {s.passage && (
                      <details className="passage">
                        <summary>对应正文</summary>
                        <p>{s.passage}</p>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </details>
        ) : null;
      })}
    </div>
  );
}
function Answer({ task, act }: { task: Task | undefined; act: Act }) {
  const { busy, state } = useContext(OperationContext);
  if (!task)
    return <div className="empty-answer">这个平台还没有采集记录。</div>;
  const recoveryReason = busy
    ? "正在执行操作，请稍候。"
    : state?.busy
      ? "请先暂停顶部监测，再恢复原会话。"
      : !task.conversation_url || !task.mode
        ? "此项尚未保存原会话或模式，请使用顶部继续监测。"
        : "";
  const retryReason = !state?.controls.start.enabled
    ? "另开对话重采前，请先完成或取消当前批次。"
    : "";
  return (
    <>
      <div className="answer-meta">
        <Badge status={task.status} />
        <span>{fmt(task.finished_at || task.started_at)}</span>
        <span>{task.model || "模型名称未公开"}</span>
      </div>
      <div className="mode-line">
        {task.mode
          ? `${task.mode.search === "enabled" ? "智能搜索已开启" : "平台自动联网"} · 思考关闭 · ${task.mode.searchTriggered === true ? "已观察到搜索来源" : task.mode.searchTriggered === false ? "未触发搜索" : "未确认是否实际搜索"}`
          : "实际模式尚未确认"}{" "}
        · 问题版本 {task.question_version}
      </div>
      {task.error && (
        <div className="result-warning">
          <AlertCircle size={16} />
          <span>{task.error}</span>
        </div>
      )}
      <article className="answer-text">
        {readingText(task) || "尚未取得完整回答。"}
      </article>
      <div className="answer-tools">
        {task.conversation_url && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              act(
                () => api(`/tasks/${task.id}/open`, {}),
                "已在该平台的独立 Chrome 中打开原会话",
              )
            }
          >
            查看原会话 <ExternalLink size={13} />
          </button>
        )}
        {[
          "paused",
          "uncertain",
          "partial",
          "waiting_verification",
          "waiting_login",
        ].includes(task.status) && (
          <button
            className="text-button"
            disabled={!!recoveryReason}
            aria-describedby={
              recoveryReason ? `recover-reason-${task.id}` : undefined
            }
            title={
              state?.busy
                ? "请先暂停监测"
                : !task.conversation_url || !task.mode
                  ? "此项尚未保存原会话或模式，使用顶部继续监测"
                  : "核对原问题并收取已有回答"
            }
            onClick={() =>
              act(
                () => api(`/tasks/${task.id}/recover`, {}),
                "已核对原会话并保存结果",
              )
            }
          >
            <RotateCcw size={13} />
            核对并恢复
          </button>
        )}
        {["uncertain", "partial", "failed", "cancelled"].includes(
          task.status,
        ) && (
          <button
            className="text-button"
            disabled={busy || !state?.controls.start.enabled}
            aria-describedby={
              retryReason ? `retry-reason-${task.id}` : undefined
            }
            title={
              !state?.controls.start.enabled
                ? "请先完成或取消当前批次"
                : "在新批次采集，原结果保留"
            }
            onClick={() =>
              act(
                () => api(`/tasks/${task.id}/retry`, {}),
                "重采批次已开始，原结果保留",
              )
            }
          >
            <Play size={13} />
            另开对话重采
          </button>
        )}
        {task.diagnostic && (
          <a
            className="text-button"
            href={`/api/diagnostics/${task.diagnostic}.png`}
            target="_blank"
            rel="noreferrer"
          >
            异常截图
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      {recoveryReason &&
        [
          "paused",
          "uncertain",
          "partial",
          "waiting_login",
          "waiting_verification",
        ].includes(task.status) && (
          <p className="action-reason" id={`recover-reason-${task.id}`}>
            {recoveryReason}
          </p>
        )}
      {retryReason &&
        ["uncertain", "partial", "failed", "cancelled"].includes(
          task.status,
        ) && (
          <p className="action-reason" id={`retry-reason-${task.id}`}>
            {retryReason}
          </p>
        )}
      <Sources sources={task.sources} status={task.source_status} />
    </>
  );
}
function Reader({
  question: suppliedQuestion,
  questionId,
  initialTask,
  initialPlatform,
  initialTab,
  onBack,
  act,
  exportFile,
}: {
  question: Q | undefined;
  questionId: number;
  initialTask: Task | null;
  initialPlatform: Platform;
  initialTab: "read" | "history";
  onBack: () => void;
  act: Act;
  exportFile: (f: string, q?: string) => void;
}) {
  const [archivedQuestion, setArchivedQuestion] = useState<Q>();
  const question = suppliedQuestion || archivedQuestion;
  useEffect(() => {
    if (!suppliedQuestion)
      void api<Q>(`/questions/${questionId}`)
        .then(setArchivedQuestion)
        .catch((e) => setError(e.message));
  }, [questionId, suppliedQuestion?.id]);
  const [tasks, setTasks] = useState<Task[]>([]),
    [tab, setTab] = useState<"read" | "platforms" | "history">(initialTab),
    [platform, setPlatform] = useState<Platform>(
      initialTask?.platform || initialPlatform,
    ),
    [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [chosen, setChosen] = useState(initialTask ? String(initialTask.id) : ""),
    [error, setError] = useState("");
  const load = useCallback(() => {
    void api<Task[]>(`/results?questionId=${questionId}`)
      .then((rows) =>
        setTasks(
          initialTask && !rows.some((t) => t.id === initialTask.id)
            ? [...rows, initialTask]
            : rows,
        ),
      )
      .catch((e) => setError(e.message));
  }, [questionId, initialTask?.id]);
  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [load]);
  const history = tasks.filter((t) => t.platform === platform),
    comparable = history.filter(
      (t) => t.status === "succeeded" && Boolean(t.answer),
    ),
    selected = history.find((t) => String(t.id) === chosen) || history[0],
    a = comparable.find((t) => String(t.id) === left) || comparable[1],
    b = comparable.find((t) => String(t.id) === right) || comparable[0];
  if (!question)
    return (
      <>
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} />
          返回
        </button>
        <p>问题已移出问题库，可在采集记录中查看已有结果。</p>
      </>
    );
  return (
    <div className="reader">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} />
        返回问题列表
      </button>
      <header className="reader-heading">
        <div>
          <div className="question-meta">
            Q{String(question.id).padStart(3, "0")}{" "}
            <span>{question.group_name || "未分组"}</span>
          </div>
          <h1>{question.text}</h1>
        </div>
        <div className="export-control">
          <ArrowDownToLine size={16} />
          <select
            aria-label="导出这个问题"
            value=""
            onChange={(e) =>
              exportFile(e.target.value, `?questionId=${question.id}`)
            }
          >
            <option value="" disabled>
              导出此问题
            </option>
            <option value="answers.csv">回答 CSV</option>
            <option value="sources.csv">来源 CSV</option>
            <option value="results.json">完整 JSON</option>
          </select>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="tabs">
        {(
          [
            { id: "read", label: "回答原文" },
            { id: "platforms", label: "三平台对照" },
            { id: "history", label: "历史变化" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={tab === t.id ? "active" : ""}
          >
            {t.label}
          </button>
        ))}
        <span>{tasks.length} 条采集记录</span>
      </div>
      {tab !== "platforms" && (
        <div className="reader-controls">
          <div className="segmented">
            {platformIds.map((p) => (
              <button
                key={p}
                className={platform === p ? "active" : ""}
                onClick={() => {
                  setPlatform(p);
                  setChosen("");
                  setLeft("");
                  setRight("");
                }}
              >
                {platformNames[p]}
              </button>
            ))}
          </div>
          {tab === "read" && (
            <select
              aria-label="采集时间"
              value={chosen || String(history[0]?.id || "")}
              onChange={(e) => setChosen(e.target.value)}
            >
              {!history.length && <option>尚无记录</option>}
              {history.map((t) => (
                <option key={t.id} value={t.id}>
                  {fmt(t.finished_at || t.started_at)} · {labels[t.status]} · #
                  {t.id}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {tab === "read" && (
        <div className="reading-surface">
          <Answer task={selected} act={act} />
        </div>
      )}
      {tab === "platforms" && (
        <div className="platform-columns">
          {platformIds.map((p) => (
            <section className="platform-column" key={p}>
              <h2>{platformNames[p]}</h2>
              <Answer task={tasks.find((t) => t.platform === p)} act={act} />
            </section>
          ))}
        </div>
      )}
      {tab === "history" &&
        (comparable.length < 2 ? (
          <div className="empty-state">
            <GitCompareArrows size={32} />
            <h3>还需要第二条记录</h3>
            <p>
              同一问题在该平台完成两次完整采集后，即可对照变化。未完成或来源提取失败的结果不会计为正文、来源移除。
            </p>
          </div>
        ) : (
          <>
            <div className="comparison-pickers">
              <label>
                较早记录
                <select
                  value={left || String(a?.id)}
                  onChange={(e) => setLeft(e.target.value)}
                >
                  {comparable.map((t) => (
                    <option key={t.id} value={t.id}>
                      {fmt(t.finished_at || t.started_at)} · #{t.id} ·{" "}
                      {labels[t.status]}
                    </option>
                  ))}
                </select>
              </label>
              <ArrowRight size={18} />
              <label>
                较新记录
                <select
                  value={right || String(b?.id)}
                  onChange={(e) => setRight(e.target.value)}
                >
                  {comparable.map((t) => (
                    <option key={t.id} value={t.id}>
                      {fmt(t.finished_at || t.started_at)} · #{t.id} ·{" "}
                      {labels[t.status]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {a && b && (
              <>
                <div className="diff-legend">
                  <span>
                    <i className="added-key" />
                    新增文字
                  </span>
                  <span>
                    <i className="removed-key" />
                    移除文字
                  </span>
                  {a.question_version !== b.question_version && (
                    <strong>问题版本不同，回答变化也可能来自问题修改。</strong>
                  )}
                </div>
                <article className="diff-surface">
                  {diffLines(readingText(a), readingText(b)).map((p, i) =>
                    p.added ? (
                      <ins key={i}>{p.value}</ins>
                    ) : p.removed ? (
                      <del key={i}>{p.value}</del>
                    ) : (
                      <span key={i}>{p.value}</span>
                    ),
                  )}
                </article>
                <SourceDelta before={a.sources} after={b.sources} />
              </>
            )}
          </>
        ))}
    </div>
  );
}
function SourceDelta({ before, after }: { before: Source[]; after: Source[] }) {
  const key = (s: Source) => s.kind + "|" + s.url;
  const added = after.filter((s) => !before.some((t) => key(t) === key(s))),
    removed = before.filter((s) => !after.some((t) => key(t) === key(s)));
  return (
    <section className="source-delta">
      <h2>
        来源变化{" "}
        <span>
          新增 {added.length} · 移除 {removed.length}
        </span>
      </h2>
      <div>
        {[
          { list: added, title: "新增来源", cls: "added" },
          { list: removed, title: "移除来源", cls: "removed" },
        ].map((g) => (
          <section key={g.cls}>
            <h3>{g.title}</h3>
            {!g.list.length && <p className="muted">没有{g.title}</p>}
            {g.list.map((s, i) => (
              <a
                key={i}
                className={g.cls}
                href={/^https?:/.test(s.url) ? s.url : "#"}
                target="_blank"
                rel="noreferrer"
              >
                <small>{s.kind === "citation" ? "正文引用" : "检索参考"}</small>
                {s.title}
                <ExternalLink size={12} />
              </a>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}

function Records({
  state,
  onRead,
  act,
  exportFile,
}: {
  state: State | null;
  onRead: (task: Task) => void;
  act: Act;
  exportFile: (f: string, q?: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]),
    [batch, setBatch] = useState(""),
    [platform, setPlatform] = useState(""),
    [status, setStatus] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [error, setError] = useState("");
  const params = new URLSearchParams();
  if (batch) params.set("batchId", batch);
  if (platform) params.set("platform", platform);
  if (status) params.set("status", status);
  if (from)
    params.set("from", new Date(from + "T00:00:00+08:00").toISOString());
  if (to) params.set("to", new Date(to + "T23:59:59+08:00").toISOString());
  const query = params.toString();
  useEffect(() => {
    const load = () =>
      void api<Task[]>("/results?" + query)
        .then(setTasks)
        .catch((e) => setError(e.message));
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [query]);
  return (
    <>
      {state?.batches[0] && (
        <div className="batch-overview">
          <div>
            <strong>最近一轮 #{state.batches[0].id}</strong>
            <span>
              {fmt(state.batches[0].created_at)} ·{" "}
              {state.batches[0].trigger === "schedule"
                ? "定时采集"
                : state.batches[0].trigger === "retry"
                  ? "手动重采"
                  : "手动采集"}
            </span>
            {state.batches[0].scheduled_at && (
              <small>原计划 {fmt(state.batches[0].scheduled_at)}</small>
            )}
          </div>
          <p>
            完成 {state.batches[0].succeeded} / {state.batches[0].total} ·
            待处理 {state.batches[0].waiting}
          </p>
        </div>
      )}
      {batch && state && (
        <div className="history-actions">
          <button
            className="button"
            disabled={!state.controls.rerun.enabled}
            title={
              state.controls.rerun.reason ||
              "使用原问题版本和平台范围创建新批次"
            }
            onClick={() =>
              act(
                () => api(`/batches/${batch}/rerun`, {}),
                "已按原批次范围重新开始",
              )
            }
          >
            <RotateCcw size={15} />
            重新运行所选批次
          </button>
        </div>
      )}
      <div className="filters record-filters">
        <select
          aria-label="采集批次"
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
        >
          <option value="">全部批次</option>
          {state?.batches.map((b) => (
            <option key={b.id} value={b.id}>
              #{b.id} · {fmt(b.created_at)}
            </option>
          ))}
        </select>
        <select
          aria-label="平台筛选"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option value="">全部平台</option>
          {platformIds.map((p) => (
            <option key={p} value={p}>
              {platformNames[p]}
            </option>
          ))}
        </select>
        <select
          aria-label="结果状态"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">全部状态</option>
          {Object.entries(labels).map(([k, v]) => (
            <option value={k} key={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="开始日期"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span>至</span>
        <input
          type="date"
          aria-label="结束日期"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          className="text-button"
          onClick={() => exportFile("results.json", "?" + query)}
        >
          <ArrowDownToLine size={14} />
          导出筛选结果
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>问题</th>
              <th>平台</th>
              <th>状态</th>
              <th>引用 / 参考</th>
              <th>采集时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <button className="question-link" onClick={() => onRead(t)}>
                    {t.question_text}
                  </button>
                  <small className="muted">
                    批次 #{t.batch_id} · 版本 {t.question_version}
                  </small>
                </td>
                <td>{platformNames[t.platform]}</td>
                <td>
                  <Badge status={t.status} />
                </td>
                <td>
                  {t.sources.filter((s) => s.kind === "citation").length} /{" "}
                  {t.sources.filter((s) => s.kind === "search").length}
                </td>
                <td className="nowrap">{fmt(t.finished_at || t.started_at)}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`查看任务 ${t.id}`}
                    onClick={() => onRead(t)}
                  >
                    <ArrowRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tasks.length && (
          <div className="empty-state">
            <FolderOpen size={32} />
            <h3>还没有采集记录</h3>
            <p>启动一轮监测后，这里会保存任务进度、回答和来源。</p>
          </div>
        )}
      </div>
      <p className="muted fine-print">
        面板最多显示最近 500 条匹配记录；导出包含全部匹配数据。
      </p>
    </>
  );
}
function Settings({ state, act }: { state: State; act: Act }) {
  const { busy } = useContext(OperationContext);
  const [exited, setExited] = useState(false);
  const [schedule, setSchedule] = useState(state.schedule),
    [auto, setAuto] = useState(state.allowAutoSearch),
    [notifications, setNotifications] = useState(state.notifications);
  return (
    <div className="settings-layout">
      <section className="settings-section">
        <div className="settings-title">
          <Clock3 size={20} />
          <div>
            <h2>采集计划</h2>
            <p>服务运行且 Mac 开机联网时执行，漏采只补最近一轮。</p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                api(
                  "/settings",
                  { schedule, allowAutoSearch: auto, notifications },
                  "PATCH",
                ),
              "设置已保存",
            );
          }}
        >
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) =>
                setSchedule({ ...schedule, enabled: e.target.checked })
              }
            />
            启用自动监测
          </label>
          <div className="schedule-fields">
            <label>
              频率
              <select
                value={schedule.frequency}
                onChange={(e) =>
                  setSchedule({
                    ...schedule,
                    frequency: e.target.value as "weekly" | "daily",
                  })
                }
              >
                <option value="weekly">每周一次</option>
                <option value="daily">每天一次</option>
              </select>
            </label>
            {schedule.frequency === "weekly" && (
              <label>
                星期
                <select
                  value={schedule.weekday}
                  onChange={(e) =>
                    setSchedule({
                      ...schedule,
                      weekday: Number(e.target.value),
                    })
                  }
                >
                  {["日", "一", "二", "三", "四", "五", "六"].map((s, i) => (
                    <option key={i} value={i}>
                      星期{s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              开始时间
              <input
                type="time"
                required
                value={`${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`}
                onChange={(e) => {
                  const [hour, minute] = e.target.value.split(":").map(Number);
                  setSchedule({ ...schedule, hour, minute });
                }}
              />
            </label>
          </div>
          <p className="muted">
            时区固定为北京时间（Asia/Shanghai）。下次计划：{fmt(state.nextRun)}
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            豆包与元宝允许自动联网，记录实际搜索情况
          </label>
          <p className="field-help">
            保持问题原文。关闭后，这两家会因无法确认强制搜索而停止提交。
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={notifications}
              onChange={(e) => setNotifications(e.target.checked)}
            />
            完成、异常及需要人工处理时，发送 Mac 系统通知
          </label>
          <p className="field-help">
            可在 macOS 通知设置中允许通知；面板始终保留事件记录。
          </p>
          <button className="button primary" type="submit">
            <Check size={15} />
            保存设置
          </button>
        </form>
      </section>
      <section className="settings-section">
        <div className="settings-title">
          <ShieldCheck size={20} />
          <div>
            <h2>平台与登录</h2>
            <p>
              每个平台使用独立 Chrome 登录态，首次需要至少两条真实结果核对。
            </p>
          </div>
        </div>
        <div className="platform-settings">
          {state.platforms.map((p) => (
            <div className="platform-setting" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <p>
                  {p.validated
                    ? "已完成两条样题核对"
                    : p.waiting
                      ? "有任务需要人工处理"
                      : "等待真实采集验证"}
                  {p.waiting ? ` · ${p.waiting} 项待处理` : ""}
                </p>
              </div>
              <div className="row-actions">
                <button
                  className="button"
                  disabled={busy || state.busy}
                  title={
                    state.busy
                      ? "请先暂停监测，再打开登录窗口"
                      : "使用独立 Chrome 登录态"
                  }
                  onClick={() =>
                    act(
                      () => api(`/platforms/${p.id}/login`, {}),
                      "请在独立 Chrome 窗口中登录；不要在聊天中提供密码",
                    )
                  }
                >
                  打开登录窗口
                  <ExternalLink size={13} />
                </button>
                {p.waiting > 0 && (
                  <button
                    className="button"
                    onClick={() =>
                      act(
                        () => api(`/platforms/${p.id}/resume`, {}),
                        state.paused
                          ? "已解除平台等待；点击顶部继续监测恢复本轮"
                          : "平台已恢复，优先检查原会话",
                      )
                    }
                  >
                    登录 / 验证已完成
                  </button>
                )}
                {!p.validated && (
                  <button
                    className="text-button"
                    onClick={() =>
                      act(
                        () => api(`/platforms/${p.id}/validate`, {}),
                        "该平台已记录为核对通过",
                      )
                    }
                  >
                    <Check size={14} />
                    两条结果已核对
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-title">
          <FolderOpen size={20} />
          <div>
            <h2>本机数据与服务</h2>
            <p>回答和来源长期保存，异常截图及诊断文件保留 30 天。</p>
          </div>
        </div>
        <code className="data-path">{state.dataDir}</code>
        <p className="muted">
          关闭网页不会停止服务。手动退出后，下次需要重新启动。
        </p>
        <div className="row-actions align-start">
          <button
            className="button danger"
            onClick={() => {
              if (
                window.confirm(
                  "退出本机服务？未完成任务会保持暂停，下次启动后可继续。",
                )
              )
                void act(
                  () => api("/shutdown", {}),
                  "服务已退出，下次请重新启动",
                ).then((ok) => {
                  if (ok) setExited(true);
                });
            }}
          >
            <Power size={15} />
            {exited ? "服务已退出" : "退出服务"}
          </button>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-title">
          <FileText size={20} />
          <div>
            <h2>最近事件</h2>
            <p>运行记录帮助判断采集何时完成、哪里需要处理。</p>
          </div>
        </div>
        <ul className="event-list">
          {state.events.length ? (
            state.events.slice(0, 25).map((e) => (
              <li key={e.id}>
                <time>{fmt(e.created_at)}</time>
                <span>{e.message}</span>
              </li>
            ))
          ) : (
            <li>还没有运行事件。</li>
          )}
        </ul>
      </section>
    </div>
  );
}
