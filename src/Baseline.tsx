import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Check,
  ArrowDownToLine,
  Pencil,
  X,
  BarChart3,
} from "lucide-react";
import { platformIds, platformNames, type Platform } from "../server/types";
import type {
  BaselineConfig,
  BaselineReport,
  BaselineReview,
} from "../server/baseline";

type Request = <T = any>(
  path: string,
  body?: unknown,
  method?: string,
) => Promise<T>;
type Act = (fn: () => Promise<unknown>, message?: string) => Promise<boolean>;
const percent = (n: number | null | undefined) =>
  n === null || n === undefined ? "待核对" : `${(n * 100).toFixed(1)}%`;
const sentimentNames = {
  positive: "正向",
  neutral: "中性",
  negative: "负向",
  mixed: "褒贬并存",
};
const date = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—";
export default function Baseline({
  request,
  act,
  busy,
  onRead,
}: {
  request: Request;
  act: Act;
  busy: boolean;
  onRead: (id: number) => void;
}) {
  const [report, setReport] = useState<BaselineReport | null>(null),
    [draft, setDraft] = useState<BaselineConfig | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [group, setGroup] = useState(""),
    [sourceKind, setSourceKind] = useState("citation");
  const [editing, setEditing] = useState<BaselineReport["rows"][number] | null>(
      null,
    ),
    [showConfig, setShowConfig] = useState(false);
  const [aliasEdits, setAliasEdits] = useState<Record<number, string>>({});
  const params = new URLSearchParams({ sourceKind });
  if (platform) params.set("platform", platform);
  if (group) params.set("group", group);
  if (from)
    params.set("from", new Date(from + "T00:00:00+08:00").toISOString());
  if (to) params.set("to", new Date(to + "T23:59:59+08:00").toISOString());
  const query = params.toString();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await request<BaselineReport>("/baseline?" + query);
      setReport(r);
      setDraft((old) => old || r.config);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [request, query]);
  useEffect(() => {
    void load();
  }, [load]);
  const scope = report?.scope;
  const reviewed = report
    ? Object.values(report.sentiment)
        .slice(0, 4)
        .reduce((a, b) => a + b, 0)
    : 0;
  async function saveConfig() {
    if (!draft) return;
    setError("");
    await act(async () => {
      try {
        const saved = await request<BaselineConfig>(
          "/baseline/config",
          {
            brands: draft.brands.map((b, i) => ({
              ...b,
              aliases:
                aliasEdits[i] === undefined
                  ? b.aliases
                  : aliasEdits[i]
                      .split(/[,，、]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
            })),
          },
          "PATCH",
        );
        setDraft(saved);
        setAliasEdits({});
        setEditing(null);
        await load();
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
    }, "品牌配置已保存，历史数据已重新统计");
  }
  return (
    <div className="baseline-page">
      <div className="baseline-intro">
        <div>
          <strong>目标品牌：{report?.config.brands[0].name || "加载中"}</strong>
          <p>
            竞品：
            {report?.config.brands
              .slice(1)
              .map((b) => b.name)
              .join("、") || "未设置"}
            。所有比例仅针对当前筛选样本。
          </p>
        </div>
        <button className="button" onClick={() => setShowConfig(!showConfig)}>
          <Pencil size={14} />
          {showConfig ? "收起品牌配置" : "品牌与竞品配置"}
        </button>
        <a className="button" href={`/api/baseline/export?${query}`}>
          <ArrowDownToLine size={14} />
          导出基线 JSON
        </a>
      </div>
      {showConfig && draft && (
        <form
          className="inline-panel baseline-config"
          onSubmit={(e) => {
            e.preventDefault();
            void saveConfig();
          }}
        >
          <h2>品牌与别名</h2>
          <p>
            第一行为目标品牌，其余为竞品。改名或别名变化会重新统计已有回答；目标品牌变化后，旧情感标注不会套用到新品牌。
          </p>
          {draft.brands.map((b, i) => (
            <div className="brand-config-row" key={i}>
              <label>
                {i === 0 ? "目标品牌" : "竞品"}
                <input
                  aria-label={i === 0 ? "目标品牌" : `竞品 ${i}`}
                  required
                  maxLength={60}
                  value={b.name}
                  onChange={(e) =>
                    setDraft({
                      brands: draft.brands.map((v, j) =>
                        i === j ? { ...v, name: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                别名（逗号分隔）
                <input
                  aria-label={`品牌别名 ${i + 1}`}
                  value={aliasEdits[i] ?? b.aliases.join(", ")}
                  onChange={(e) =>
                    setAliasEdits({ ...aliasEdits, [i]: e.target.value })
                  }
                />
              </label>
              {i > 0 && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除竞品 ${i}`}
                  onClick={() => {
                    setDraft({
                      brands: draft.brands
                        .map((b, j) => ({
                          ...b,
                          aliases:
                            aliasEdits[j] === undefined
                              ? b.aliases
                              : aliasEdits[j]
                                  .split(/[,，、]/)
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                        }))
                        .filter((_, j) => j !== i),
                    });
                    setAliasEdits({});
                  }}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          <div className="row-actions">
            <button
              className="button"
              type="button"
              disabled={draft.brands.length >= 30}
              onClick={() =>
                setDraft({
                  brands: [...draft.brands, { name: "", aliases: [] }],
                })
              }
            >
              <Plus size={14} />
              添加竞品
            </button>
            <button className="button primary" disabled={busy}>
              <Check size={14} />
              保存品牌配置
            </button>
          </div>
        </form>
      )}
      <div className="filters baseline-filters">
        <label>
          AI 平台
          <select
            aria-label="基线平台"
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
        </label>
        <label>
          开始日期
          <input
            type="date"
            aria-label="基线开始日期"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            aria-label="基线结束日期"
            min={from || undefined}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          问题分组
          <input
            aria-label="基线问题分组"
            placeholder="全部分组"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
        </label>
        <label>
          信源口径
          <select
            aria-label="基线信源口径"
            value={sourceKind}
            onChange={(e) => setSourceKind(e.target.value)}
          >
            <option value="citation">正文实际引用</option>
            <option value="search">检索参考列表</option>
          </select>
        </label>
        <button
          className="button"
          onClick={() => void load()}
          disabled={loading}
        >
          刷新统计
        </button>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="muted" role="status">
          正在计算基线…
        </p>
      )}
      {report && (
        <>
          <div className="baseline-scope">
            <BarChart3 size={18} />
            <p>
              有效回答 <strong>{scope!.answers}</strong> 条 / 匹配记录{" "}
              {scope!.records} 条 · 未完成或无正文排除 {scope!.excluded}{" "}
              条。信源完整回答 {scope!.sourceAnswers} 条；来源未完成另排除{" "}
              {scope!.sourceExcluded} 条。更新时间 {date(report.generatedAt)}
            </p>
          </div>
          {!scope!.answers && (
            <div className="empty-state">
              <h3>暂无可统计的完整回答</h3>
              <p>完成采集或调整筛选后，统计会使用实际回答，不生成示例数据。</p>
            </div>
          )}
          <section className="baseline-section">
            <h2>品牌表现</h2>
            <p className="baseline-method">
              提及率＝提及该品牌的回答数 ÷
              有效回答数。声量份额＝该品牌名称及别名出现次数 ÷
              已配置品牌总出现次数。仅按回答正文匹配，别名重叠不重复计数。
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>品牌</th>
                    <th>提及回答</th>
                    <th>品牌提及率</th>
                    <th>提及次数</th>
                    <th>品牌声量份额</th>
                    <th>进入前三</th>
                    <th>TOP3 率</th>
                  </tr>
                </thead>
                <tbody>
                  {report.brands.map((b, i) => (
                    <tr key={b.name}>
                      <td>
                        <strong>{b.name}</strong>
                        {i === 0 && (
                          <small className="muted"> · 目标品牌</small>
                        )}
                      </td>
                      <td>
                        {b.mentioned} / {scope!.answers}
                      </td>
                      <td>{percent(b.mentionRate)}</td>
                      <td>{b.mentions}</td>
                      <td>{percent(b.voiceShare)}</td>
                      <td>
                        {b.top3Count} / {scope!.ranked}
                      </td>
                      <td>{percent(b.top3Rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="baseline-method">
              TOP3 分母为已判定排名的 {scope!.ranked} 条回答；未判定{" "}
              {scope!.rankUnjudged} 条、人工标为不适用{" "}
              {scope!.rankNotApplicable}{" "}
              条均排除。自动只识别带数字序号且包含已配置品牌的列表，首次提到的品牌不等于排名第一。可在下方逐条人工纠正。
            </p>
          </section>
          <div className="baseline-columns">
            <section className="baseline-section">
              <h2>各网站占总信源比例</h2>
              <p className="baseline-method">
                {sourceKind === "citation" ? "正文实际引用" : "检索参考列表"}共{" "}
                {scope!.totalSources} 条；同一回答内相同 URL
                去重，跨回答重复引用分别计次。www
                与主机名归并；不同子域单列。不是全网流量或独立文章市占率。
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>网站</th>
                      <th>信源数</th>
                      <th>占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.websites.map((s) => (
                      <tr key={s.site}>
                        <td>{s.site}</td>
                        <td>{s.count}</td>
                        <td>
                          <Share value={s.share} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.websites.length && (
                  <p className="table-empty">当前口径没有可统计信源。</p>
                )}
              </div>
            </section>
            <section className="baseline-section">
              <h2>{scope!.target}的情感倾向</h2>
              <p className="baseline-method">
                针对目标品牌的人工核对结果。已核对 {reviewed} 条，未核对{" "}
                {report.sentiment.unreviewed} 条；未提及目标品牌{" "}
                {report.sentiment.notMentioned} 条不进入分母。不将未知归为中性。
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>倾向</th>
                      <th>回答数</th>
                      <th>已核对样本占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(sentimentNames).map(([key, name]) => (
                      <tr key={key}>
                        <td>{name}</td>
                        <td>
                          {report.sentiment[key as keyof typeof sentimentNames]}
                        </td>
                        <td>
                          <Share
                            value={
                              reviewed
                                ? report.sentiment[
                                    key as keyof typeof sentimentNames
                                  ] / reviewed
                                : null
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <section className="baseline-section">
            <h2>AI 回答各内容结构占比</h2>
            <p className="baseline-method">
              按保存的标题、表格与段落格式规则识别，统计非空白字符数；无明确结构标记的文字归为“具体内容”。它是可复现的格式统计，不是语义审核。引用文章全文未采集，因此不能据此计算来源文章自身的结构占比。
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>内容结构</th>
                    <th>字符数</th>
                    <th>正文字符占比</th>
                    <th>包含该结构的回答</th>
                    <th>回答覆盖率</th>
                  </tr>
                </thead>
                <tbody>
                  {report.structures.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>{s.characters}</td>
                      <td>
                        <Share value={s.share} />
                      </td>
                      <td>
                        {s.answers} / {scope!.answers}
                      </td>
                      <td>{percent(s.coverage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="baseline-section">
            <h2>样本明细与人工核对</h2>
            <p className="baseline-method">
              时间为实际采集时间（北京时间）。情感针对“{scope!.target}”；TOP3
              可填写真实前三品牌，也可标为排名不适用。未完成记录不会进入本表。
            </p>
            {editing && (
              <ReviewEditor
                key={editing.id + scope!.target}
                row={editing}
                target={scope!.target}
                busy={busy}
                onClose={() => setEditing(null)}
                onSave={async (review) => {
                  const ok = await act(async () => {
                    try {
                      await request(
                        `/baseline/reviews/${editing.id}`,
                        review,
                        "PUT",
                      );
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                      throw e;
                    }
                  }, "人工核对已保存");
                  if (ok) setEditing(null);
                }}
              />
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间 / 平台</th>
                    <th>问题</th>
                    <th>目标品牌提及</th>
                    <th>前三品牌</th>
                    <th>目标品牌情感</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.slice(0, 200).map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">
                        {date(r.time)}
                        <br />
                        <span className="muted">
                          {platformNames[r.platform as Platform]} · #{r.id}
                        </span>
                      </td>
                      <td>
                        <button
                          className="question-link"
                          onClick={() => onRead(r.id)}
                        >
                          {r.question}
                        </button>
                      </td>
                      <td>{r.targetMentioned ? "已提及" : "未提及"}</td>
                      <td>
                        {r.rankingMethod === "not_applicable"
                          ? "不适用"
                          : r.top3 === null
                            ? "未判定"
                            : r.top3.length
                              ? r.top3.join("、")
                              : "已核对：无配置品牌进入前三"}
                        {r.rankingMethod === "explicit_list" && (
                          <small className="muted"> · 规则识别</small>
                        )}
                      </td>
                      <td>
                        {!r.targetMentioned
                          ? "未提及"
                          : r.sentiment
                            ? sentimentNames[r.sentiment]
                            : "未核对"}
                      </td>
                      <td>
                        <button
                          className="button"
                          onClick={() => setEditing(r)}
                        >
                          <Pencil size={13} />
                          核对
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="baseline-method">
              明细最多显示 200 条，指标与 JSON
              导出包含全部匹配数据。品牌与别名修改不会更改原回答。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
function Share({ value }: { value: number | null }) {
  return (
    <span className="baseline-share">
      <span>{percent(value)}</span>
      {value !== null && (
        <span className="baseline-bar" aria-hidden="true">
          <i style={{ width: `${value * 100}%` }} />
        </span>
      )}
    </span>
  );
}
function ReviewEditor({
  row,
  target,
  busy,
  onClose,
  onSave,
}: {
  row: BaselineReport["rows"][number];
  target: string;
  busy: boolean;
  onClose: () => void;
  onSave: (review: BaselineReview) => Promise<void>;
}) {
  const [sentiment, setSentiment] = useState(
      row.review?.target === target ? row.review.sentiment || "" : "",
    ),
    [top, setTop] = useState(row.top3?.join("、") || ""),
    [rankMode, setRankMode] = useState(
      row.rankingMethod === "not_applicable"
        ? "na"
        : row.top3 !== null
          ? "known"
          : "unknown",
    ),
    [note, setNote] = useState(row.review?.note || "");
  return (
    <form
      className="inline-panel baseline-review"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          target,
          sentiment: (sentiment || null) as BaselineReview["sentiment"],
          top3:
            rankMode === "known"
              ? top
                  .split(/[,，、]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : null,
          rankingNotApplicable: rankMode === "na",
          note,
        });
      }}
    >
      <div className="panel-heading">
        <h3>
          核对 #{row.id} · {target}
        </h3>
        <button type="button" aria-label="关闭基线核对" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <p>{row.question}</p>
      <div className="review-answer">
        {row.mentions.map((b) => `${b.name}：${b.count} 次`).join(" · ")}
      </div>
      <details className="review-original" open>
        <summary>本次完整回答</summary>
        <article className="answer-text">{row.answer}</article>
      </details>
      <div className="baseline-review-fields">
        <label>
          目标品牌情感
          <select
            aria-label="目标品牌情感"
            disabled={!row.targetMentioned}
            value={sentiment}
            onChange={(e) => setSentiment(e.target.value as typeof sentiment)}
          >
            <option value="">未核对</option>
            {Object.entries(sentimentNames).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
          {!row.targetMentioned && (
            <small>未提及目标品牌，不作情感判断。</small>
          )}
        </label>
        <label>
          排名判定
          <select
            aria-label="排名判定"
            value={rankMode}
            onChange={(e) => setRankMode(e.target.value)}
          >
            <option value="unknown">未判定，先保持未知</option>
            <option value="known">已核对前三品牌</option>
            <option value="na">无有效榜单 / 不适用</option>
          </select>
        </label>
        {rankMode === "known" && (
          <label>
            前三品牌（按顺序，逗号分隔）
            <input
              aria-label="前三品牌"
              value={top}
              onChange={(e) => setTop(e.target.value)}
              placeholder="品牌甲、品牌乙、品牌丙"
            />
            <small>最多三个；留空表示已核对且配置品牌均未进前三。</small>
          </label>
        )}
        <label>
          核对备注
          <textarea
            aria-label="基线核对备注"
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <button className="button primary" disabled={busy}>
        <Check size={14} />
        保存核对
      </button>
    </form>
  );
}
