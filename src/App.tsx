import { useState, useEffect, useCallback, type FormEvent } from "react";
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
};
type State = {
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

export default function App() {
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
            seegeo v0.1 <ExternalLink size={12} />
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
        <div className="workspace">
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
                  <section className="run-strip" aria-label="监测运行状态">
                    <div className="run-summary">
                      <div
                        className={`run-symbol ${state?.busy ? "live" : ""}`}
                      >
                        {state?.busy ? (
                          <LoaderCircle size={22} className="spin" />
                        ) : (
                          <Clock3 size={22} />
                        )}
                      </div>
                      <div>
                        <strong>
                          {state?.busy
                            ? "正在采集"
                            : state?.paused
                              ? "监测已暂停"
                              : latest?.waiting
                                ? "有任务需要你处理"
                                : "准备好下一轮监测"}
                        </strong>
                        <p>
                          {state?.busy
                            ? `本轮共 ${latest?.total || 0} 项 · 已完成 ${(latest?.succeeded || 0) + (latest?.partial || 0) + (latest?.failed || 0)} 项`
                            : state?.schedule.enabled
                              ? `下次计划 ${fmt(state.nextRun)} · 北京时间${state.platforms.some((p) => !p.validated) ? " · 待三平台验证后启用" : ""}`
                              : "自动监测已关闭，仍可手动采集"}
                        </p>
                      </div>
                    </div>
                    <div className="run-actions">
                      {state?.busy || state?.paused ? (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              api(state.paused ? "/resume" : "/pause", {}),
                            )
                          }
                        >
                          {state.paused ? (
                            <Play size={15} />
                          ) : (
                            <Pause size={15} />
                          )}{" "}
                          {state.paused ? "继续监测" : "暂停"}
                        </button>
                      ) : null}
                      <button
                        className="button primary"
                        disabled={busy || state?.busy}
                        onClick={() => setRunOpen(!runOpen)}
                      >
                        <Play size={15} />
                        {selected.length
                          ? `采集 ${selected.length} 个问题`
                          : "开始一轮"}
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  </section>
                  {latest && latest.total > 0 && (
                    <div className="progress-track" aria-label="最近批次进度">
                      <span
                        style={{
                          width: `${100 * ((latest.succeeded + latest.partial + latest.failed + latest.cancelled) / latest.total)}%`,
                        }}
                      />
                    </div>
                  )}
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
                        disabled={busy || !platforms.length}
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
                                {q.version > 1 && <span>版本 {q.version}</span>}
                              </div>
                            </td>
                            {platformIds.map((p) => {
                              const t = q.latest.find((t) => t.platform === p);
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
                              ? (setSearch(""), setGroup(""), setEnabled("all"))
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
        </div>
        <footer className="page-footer">
          <span>seegeo · 回答与来源档案</span>
          <span>Asia/Shanghai · 数据保存在你的 Mac</span>
        </footer>
      </main>
    </div>
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
  if (!task)
    return <div className="empty-answer">这个平台还没有采集记录。</div>;
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
          <a
            className="text-button"
            href={task.conversation_url}
            target="_blank"
            rel="noreferrer"
          >
            查看原会话
            <ExternalLink size={13} />
          </a>
        )}
        {[
          "uncertain",
          "partial",
          "waiting_verification",
          "waiting_login",
        ].includes(task.status) && (
          <button
            className="text-button"
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
            onClick={() => {
              if (
                window.confirm(
                  "将在新对话中重新采集，原结果保留。请先核对原会话，确认需要重采。",
                )
              )
                void act(
                  () => api(`/tasks/${task.id}/retry`, {}),
                  "已创建重采批次；点击继续监测开始",
                );
            }}
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
          {!state.batches[0].finished_at && (
            <button
              className="button"
              onClick={() =>
                act(
                  () => api(`/batches/${state.batches[0].id}/cancel`, {}),
                  "未完成任务已取消",
                )
              }
            >
              取消本轮剩余任务
            </button>
          )}
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
                        "已处理登录状态；已提交的问题仍需在详情核对原会话",
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
            className="button"
            onClick={() =>
              act(() => api(state.paused ? "/resume" : "/pause", {}))
            }
          >
            {state.paused ? <Play size={15} /> : <Pause size={15} />}{" "}
            {state.paused ? "继续监测" : "暂停监测"}
          </button>
          <button
            className="button danger"
            onClick={() => {
              if (
                window.confirm(
                  "退出本机服务？正在生成的回答会标记为需要核对，下次启动后可恢复。",
                )
              )
                void api("/shutdown", {}).then(() => window.location.reload());
            }}
          >
            <Power size={15} />
            退出服务
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
