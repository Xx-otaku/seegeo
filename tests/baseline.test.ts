import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBaseline,
  defaultBaselineConfig as config,
  structureBreakdown,
  baselineConfigSchema,
  reviewSchema,
} from "../server/baseline.js";
import type { Task, Source } from "../server/types.js";
const source = (url: string, kind: Source["kind"] = "citation"): Source => ({
  url,
  kind,
  title: "来源",
  site: "",
  order: 1,
  snippet: "",
});
function task(id: number, answer: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    batch_id: 1,
    question_id: id,
    question_text: "测试问题",
    question_version: 1,
    group_name: "",
    platform: "doubao",
    status: "succeeded",
    attempts: 1,
    phase: "completed",
    answer,
    answer_html: null,
    sources: [],
    source_status: "extracted",
    model: null,
    mode: null,
    conversation_url: null,
    started_at: "2026-10-26T01:00:00Z",
    finished_at: "2026-10-26T01:01:00Z",
    error: null,
    diagnostic: null,
    interruption_reason: null,
    interrupted_at: null,
    ...patch,
  };
}
test("品牌分母排除未完成回答，部分完成回答只进入正文指标；信源去重且引用和参考分开", () => {
  const customized = {
    brands: [
      { name: "鑫君威", aliases: ["XJW", "鑫君威"] },
      ...config.brands.slice(1),
    ],
  };
  const report = buildBaseline(
    [
      task(1, "鑫君威 XJW 三棵树", {
        sources: [
          source("https://www.example.com/a?utm_source=x"),
          source("https://www.example.com/a"),
          source("https://other.example/b", "search"),
        ],
      }),
      task(2, "嘉宝莉", { sources: [source("https://blog.example.com/b")] }),
      task(3, "鑫君威", {
        status: "partial",
        source_status: "failed",
        sources: [source("https://missing.example")],
      }),
      task(4, "鑫君威", { status: "uncertain" }),
    ],
    customized,
  );
  assert.equal(report.scope.answers, 3);
  assert.equal(report.scope.sourceAnswers, 2);
  assert.equal(report.scope.totalSources, 2);
  assert.equal(report.brands[0].mentioned, 2);
  assert.equal(report.brands[0].mentionRate, 2 / 3);
  assert.equal(report.brands[0].mentions, 3);
  assert.equal(report.brands[0].voiceShare, 3 / 5);
  assert.equal(
    report.websites.find((s) => s.site === "example.com")?.share,
    0.5,
  );
  assert.equal(report.websites.length, 2);
  assert.equal(report.scope.rankUnjudged, 3);
  const search = buildBaseline(
    [
      task(1, "正文", {
        sources: [source("https://source.example", "search")],
      }),
    ],
    config,
    {},
    "search",
  );
  assert.equal(search.scope.totalSources, 1);
});
test("排名只识别品牌开头的数字清单，品牌首次出现不算TOP3，未知不计成零", () => {
  const r = buildBaseline(
    [
      task(1, "鑫君威是一个品牌。"),
      task(2, "1. **三棵树**\n2. 嘉宝莉\n4. 鑫君威"),
      task(3, "1. 加水后再用鑫君威产品搅拌。"),
    ],
    config,
  );
  assert.equal(r.scope.ranked, 1);
  assert.equal(r.scope.rankUnjudged, 2);
  assert.equal(r.brands[0].top3Rate, 0);
  assert.equal(r.brands[1].top3Rate, 1);
  assert.deepEqual(r.rows[1].top3, ["三棵树", "嘉宝莉"]);
  assert.equal(r.rows[0].top3, null);
  assert.equal(buildBaseline([], config).brands[0].mentionRate, null);
  assert.equal(
    buildBaseline([task(1, "无推荐")], config).brands[0].top3Rate,
    null,
  );
});
test("人工排名覆盖规则、情感分母为已核对提及样本，改目标品牌不复用旧情感", () => {
  const reviews = {
    "1": reviewSchema.parse({
      target: "鑫君威",
      sentiment: "positive",
      top3: ["鑫君威", "三棵树"],
    }),
    "2": reviewSchema.parse({ target: "鑫君威", rankingNotApplicable: true }),
  };
  const data = [
    task(1, "鑫君威与三棵树"),
    task(2, "鑫君威"),
    task(3, "没有配置品牌"),
  ];
  const r = buildBaseline(data, config, reviews);
  assert.equal(r.brands[0].top3Rate, 1);
  assert.equal(r.scope.ranked, 1);
  assert.equal(r.scope.rankNotApplicable, 1);
  assert.equal(r.sentiment.positive, 1);
  assert.equal(r.sentiment.unreviewed, 1);
  assert.equal(r.sentiment.notMentioned, 1);
  const changed = buildBaseline(
    data,
    { brands: [config.brands[1], config.brands[0]] },
    reviews,
  );
  assert.equal(changed.sentiment.positive, 0);
  assert.equal(changed.sentiment.unreviewed, 1);
});
test("十类结构按非空白字符分摊，标题、表格、FAQ和边界可识别，不捏造源文章结构", () => {
  const counts = structureBreakdown({
    answer: "",
    answer_html:
      "<h1>标题</h1><h2>概要</h2><p>简短介绍</p><h2>FAQ</h2><p>问题回答</p><table><tr><td>甲</td><td>乙</td></tr></table><h2>边界描述</h2><p>不适合</p>",
  });
  assert.equal(counts["标题"], 2);
  assert.equal(counts["对比表格"], 2);
  assert.ok(counts.FAQ > 0);
  assert.ok(counts["边界描述"] > 0);
  assert.equal(Object.keys(counts).length, 10);
  const r = buildBaseline(
    [task(1, "正文", { answer_html: "<h1>标题</h1><p>正文</p>" })],
    config,
  );
  assert.ok(
    Math.abs(r.structures.reduce((s, v) => s + (v.share || 0), 0) - 1) < 1e-10,
  );
});
test("别名去重和英文边界避免虚高，拒绝跨品牌共用同一别名", () => {
  const c = { brands: [{ name: "鑫君威", aliases: ["XJW", "xjw", "鑫君威"] }] };
  assert.equal(
    buildBaseline([task(1, "XJWPLUS XJW 鑫君威")], c).brands[0].mentions,
    2,
  );
  assert.equal(
    baselineConfigSchema.safeParse({
      brands: [
        { name: "甲", aliases: ["同名"] },
        { name: "乙", aliases: ["同名"] },
      ],
    }).success,
    false,
  );
});
