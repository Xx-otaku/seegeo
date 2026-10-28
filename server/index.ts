import ExcelJS from "exceljs";
import { previewRound, publicationLinks } from "./round-service.js";
import { canonicalSource } from "./baseline.js";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { retryPolicySchema } from "./retry-policy.js";
import { Runner } from "./runner.js";
import {
  platformIds,
  platformNames,
  type Platform,
  CollectorError,
} from "./types.js";
import { port, dataDir } from "./config.js";
import { nextSlot } from "./schedule.js";
import { parseQuestions, answersCSV, sourcesCSV } from "./import-export.js";
import { recoverExisting } from "./collector.js";

import {
  buildBaseline,
  baselineConfigSchema,
  defaultBaselineConfig,
  reviewSchema,
  type ReviewMap,
  type BaselineConfig,
} from "./baseline.js";
const app = Fastify({ bodyLimit: 2 * 1024 * 1024 });
const token = randomBytes(24).toString("hex");
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
const store = new Store();
const runner = new Runner(store);
if (store.getSetting("allowAutoSearch") === undefined)
  store.setSetting("allowAutoSearch", true);
const platformSchema = z.enum(platformIds);
const id = (v: unknown) => z.coerce.number().int().positive().parse(v);
const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
app.addHook("onRequest", async (req, reply) => {
  if (!localHosts.has(req.headers.host || ""))
    return reply.code(403).send({ error: "仅允许本机访问" });
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (
      req.headers.origin &&
      !new Set([
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
        "http://127.0.0.1:5173",
        "http://localhost:5173",
      ]).has(req.headers.origin)
    )
      return reply.code(403).send({ error: "请求来源不受信任" });
    if (req.headers["x-seegeo-token"] !== token)
      return reply.code(403).send({ error: "请刷新面板后重试" });
  }
  reply
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "no-referrer");
});
app.setErrorHandler((e, _req, reply) => {
  const err = e as Error;
  reply
    .code(
      e instanceof ZodError ? 400 : err.message.includes("不存在") ? 404 : 400,
    )
    .send({
      error:
        e instanceof ZodError
          ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；")
          : err.message,
    });
});
function filters(query: unknown) {
  const q = z
    .object({
      questionId: z.coerce.number().int().positive().optional(),
      batchId: z.coerce.number().int().positive().optional(),
      platform: platformSchema.optional(),
      status: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .parse(query);
  return q;
}
app.get("/api/state", () => ({
  token,
  version,
  paused: store.getSetting("paused") || false,
  busy: runner.busy,
  currentTask: runner.current,
  ...runner.controls(),
  schedule: store.schedule,
  nextRun: nextSlot(store.schedule),
  platforms: platformIds.map((id) => ({
    id,
    name: platformNames[id],
    validated: store.validatedPlatforms().includes(id),
    waiting: store.waitingCount(id),
  })),
  batches: store.batches().slice(0, 30),
  events: store.events(),
  dataDir,
  allowAutoSearch: store.getSetting("allowAutoSearch"),
  notifications: store.getSetting("notifications") !== false,
  retryPolicy: runner.retryPolicy,
}));
app.get("/api/questions", () => {
  const tasks = store.latestResults();
  return store.questions().map((q) => ({
    ...q,
    latest: platformIds
      .map((p) => tasks.find((t) => t.question_id === q.id && t.platform === p))
      .filter(Boolean)
      .map((t) => ({
        id: t!.id,
        platform: t!.platform,
        status: t!.status,
        finished_at: t!.finished_at,
        source_status: t!.source_status,
        sources_count: t!.sources_count,
      }))
      .filter(Boolean),
  }));
});
app.get<{ Params: { id: string } }>("/api/questions/:id", (req) => {
  const question = store.question(id(req.params.id));
  if (!question) throw new Error("问题不存在");
  return question;
});
app.post("/api/questions/import", (req) => {
  const body = z
    .object({
      content: z.string().min(1).max(2000000),
      format: z.enum(["text", "csv"]),
      group: z.string().max(100).default(""),
    })
    .parse(req.body);
  const items = parseQuestions(body.content, body.format, body.group);
  if (items.some((q) => q.text.length > 20000))
    throw new Error("单条问题不得超过 20000 字");
  const result = store.importQuestions(items);
  store.event(
    "questions",
    `导入 ${result.added} 个问题，跳过 ${result.skipped} 个空白或重复问题`,
  );
  return result;
});
app.patch<{ Params: { id: string } }>("/api/questions/:id", (req) => {
  store.updateQuestion(
    id(req.params.id),
    z
      .object({
        text: z.string().trim().min(1).max(20000).optional(),
        group_name: z.string().max(100).optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body),
  );
  return { ok: true };
});
app.delete<{ Params: { id: string } }>("/api/questions/:id", (req) => {
  store.deleteQuestion(id(req.params.id));
  return { ok: true };
});
app.post("/api/questions/bulk-delete", (req) => {
  const { questionIds } = z
    .object({
      questionIds: z.array(z.number().int().positive()).min(1).max(1000),
    })
    .parse(req.body);
  const removed = store.deleteQuestions(questionIds);
  store.event("questions", `批量移出 ${removed} 个问题，已有回答与来源保留`);
  return { removed };
});
app.get("/api/results", (req) =>
  store
    .tasks({ ...filters(req.query), limit: 500 })
    .map((t) => ({ ...t, can_delete: !!store.batch(t.batch_id)?.finished_at })),
);
app.post("/api/results/bulk-delete", (req) => {
  const { taskIds } = z
    .object({ taskIds: z.array(z.number().int().positive()).min(1).max(1000) })
    .parse(req.body);
  return { removed: store.deleteResults(taskIds) };
});
app.get<{ Params: { id: string } }>("/api/results/:id", (req) => {
  const task = store.task(id(req.params.id));
  if (!task) throw new Error("结果不存在");
  return task;
});
function baselineReport(query: unknown) {
  const { sourceKind, ...scope } = z
    .object({
      sourceKind: z.enum(["citation", "search"]).default("citation"),
      batchId: z.coerce.number().int().positive().optional(),
      platform: platformSchema.optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      group: z.string().optional(),
    })
    .parse(query);
  const reviews = Object.fromEntries(
    store.db
      .prepare("SELECT task_id,payload FROM baseline_reviews")
      .all()
      .map((r) => [String(r.task_id), JSON.parse(String(r.payload))]),
  ) as ReviewMap;
  const config =
    store.getSetting<BaselineConfig>("baselineConfig") || defaultBaselineConfig;
  const rows = store
    .tasks(scope)
    .filter((t) => !scope.group || t.group_name === scope.group);
  return buildBaseline(rows, config, reviews, sourceKind);
}
const webUrl = z.string().trim().url().refine(v => /^https?:\/\//i.test(v), '只支持 HTTP 或 HTTPS 链接');
app.get('/api/publications', () => ({channels:store.db.prepare('SELECT * FROM publication_channels ORDER BY name').all(), links:publicationLinks(store)}));
app.post('/api/publications/channels', req => {
  const {name}=z.object({name:z.string().trim().min(1).max(80)}).parse(req.body);
  store.db.prepare('INSERT OR IGNORE INTO publication_channels(name) VALUES (?)').run(name); return {ok:true};
});
app.delete<{Params:{id:string}}>('/api/publications/channels/:id', req => {
  const channel=id(req.params.id); if (store.db.prepare('SELECT id FROM publication_links WHERE channel_id=?').get(channel)) throw new Error('渠道下仍有链接，请先移动或删除链接');
  store.db.prepare('DELETE FROM publication_channels WHERE id=?').run(channel); return {ok:true};
});
app.post('/api/publications/links', req => {
  const body=z.object({channelId:z.number().int().positive(),urls:z.array(webUrl).min(1).max(1000)}).parse(req.body);
  return store.transaction(()=>{
    if (!store.db.prepare('SELECT id FROM publication_channels WHERE id=?').get(body.channelId)) throw new Error('渠道不存在');
    const known=new Set(publicationLinks(store).flatMap(l=>[l.url,...l.aliases]).map(canonicalSource)); let added=0;
    for(const url of body.urls) {const key=canonicalSource(url);if(known.has(key))continue;store.db.prepare('INSERT INTO publication_links(channel_id,url) VALUES (?,?)').run(body.channelId,url);known.add(key);added++;} return {added,skipped:body.urls.length-added};
  });
});
app.patch<{Params:{id:string}}>('/api/publications/links/:id', req => {
  const linkId=id(req.params.id);const body=z.object({channelId:z.number().int().positive(),url:webUrl,aliases:z.array(webUrl).max(100)}).parse(req.body);
  return store.transaction(()=>{if(!publicationLinks(store).some(x=>x.id===linkId))throw new Error('链接不存在');if(!store.db.prepare('SELECT id FROM publication_channels WHERE id=?').get(body.channelId))throw new Error('渠道不存在');
    const known=new Set(publicationLinks(store).filter(x=>x.id!==linkId).flatMap(x=>[x.url,...x.aliases]).map(canonicalSource));const own=new Set<string>();for(const url of [body.url,...body.aliases]){const key=canonicalSource(url);if(known.has(key)||own.has(key))throw new Error('链接或备用链接重复');own.add(key)}
    store.db.prepare('UPDATE publication_links SET channel_id=?,url=?,aliases=? WHERE id=?').run(body.channelId,body.url,JSON.stringify(body.aliases),linkId);return {ok:true};});
});
app.post('/api/publications/links/bulk', req => {
  const body=z.object({ids:z.array(z.number().int().positive()).min(1).max(1000),action:z.enum(['delete','move']),channelId:z.number().int().positive().optional()}).parse(req.body);
  return store.transaction(()=>{const ids=[...new Set(body.ids)];if(body.action==='move' && (!body.channelId || !store.db.prepare('SELECT id FROM publication_channels WHERE id=?').get(body.channelId)))throw new Error('目标渠道不存在');
    for(const linkId of ids){if(!store.db.prepare('SELECT id FROM publication_links WHERE id=?').get(linkId))throw new Error('链接不存在');if(body.action==='delete')store.db.prepare('DELETE FROM publication_links WHERE id=?').run(linkId);else store.db.prepare('UPDATE publication_links SET channel_id=? WHERE id=?').run(body.channelId!,linkId)}return {count:ids.length};});
});
app.get('/api/rounds', () => store.batches().filter(b => !['retry','bulk_retry'].includes(String(b.trigger))));
app.get<{Params:{id:string}}>('/api/rounds/:id/preview', req => previewRound(store,id(req.params.id)));
app.post<{Params:{id:string}}>('/api/rounds/:id/snapshots', req => {
  const root=id(req.params.id);if(runner.busy || store.hasUnfinished()) throw new Error('请先完成或暂停所有监测并结束当前批次后再保存');return store.transaction(()=>{const payload=previewRound(store,root);if(!payload.rootBatch.finished_at)throw new Error('请等待本轮结束后保存');const revision=Number(store.db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM baseline_snapshots WHERE root_batch_id=?').get(root)!.n);const result=store.db.prepare('INSERT INTO baseline_snapshots(root_batch_id,revision,created_at,payload) VALUES (?,?,?,?)').run(root,revision,new Date().toISOString(),JSON.stringify(payload));return {id:Number(result.lastInsertRowid),revision};});
});
app.get('/api/rounds/snapshots', () => store.db.prepare('SELECT id,root_batch_id,revision,created_at,payload FROM baseline_snapshots ORDER BY root_batch_id DESC,revision DESC').all().map(r=>({...r,payload:JSON.parse(String(r.payload))})));
app.delete<{Params:{id:string}}>('/api/rounds/snapshots/:id', req => {store.db.prepare('DELETE FROM baseline_snapshots WHERE id=?').run(id(req.params.id));return {ok:true}});
app.get<{Params:{id:string;format:string}}>('/api/rounds/snapshots/:id/export/:format', async (req,reply)=>{
  const row=store.db.prepare('SELECT * FROM baseline_snapshots WHERE id=?').get(id(req.params.id));if(!row)throw new Error('报告不存在');const data=JSON.parse(String(row.payload));
  if(req.params.format==='json')return reply.header('Content-Disposition',`attachment; filename="baseline-${row.id}.json"`).send(data);
  if(req.params.format!=='xlsx')throw new Error('不支持的格式');const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('基线汇总');sheet.addRow(['轮次','时间范围','AI平台','目标品牌','正文引用投放占比','检索参考投放占比','正文引用网站比例','检索参考网站比例','品牌提及率','品牌声量份额','TOP3率','应采数','完成数','品牌样本数','来源缺失数','排名未判定']);
  const pct=(v:number|null)=>v===null?'无数据':`${(v*100).toFixed(1)}%`;const sites=(x:any)=>x.websites.map((v:any)=>`${v.site} ${pct(v.share)}`).join('\n')||'无来源';
  for(const p of data.platforms)sheet.addRow([String(data.rootBatch.id),`${p.first||'—'} 至 ${p.last||'—'}`,platformNames[p.platform as Platform],data.config.brands[0].name,pct(p.sources.citation.share),pct(p.sources.search.share),sites(p.sources.citation),sites(p.sources.search),pct(p.target.mentionRate),pct(p.target.voiceShare),pct(p.target.top3Rate),p.expected,p.completed,p.brandSamples,p.sourceMissing,p.rankUnjudged]);
  sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>{c.width=24});sheet.getColumn(7).alignment={wrapText:true};sheet.getColumn(8).alignment={wrapText:true};const buffer=await workbook.xlsx.writeBuffer();return reply.header('Content-Disposition',`attachment; filename="baseline-${row.id}.xlsx"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
});
app.get("/api/baseline", (req) => baselineReport(req.query));
app.get("/api/baseline/export", (req, reply) =>
  reply
    .header(
      "Content-Disposition",
      'attachment; filename="seegeo-baseline.json"',
    )
    .send(baselineReport(req.query)),
);
app.patch("/api/baseline/config", (req) => {
  const config = baselineConfigSchema.parse(req.body);
  store.setSetting("baselineConfig", config);
  store.event("baseline", "基线统计品牌与别名已更新");
  return config;
});
app.put<{ Params: { id: string } }>("/api/baseline/reviews/:id", (req) => {
  const task = store.task(id(req.params.id));
  if (!task) throw new Error("记录不存在");
  if (!["succeeded", "partial"].includes(task.status) || !task.answer)
    throw new Error("只能核对已有完整回答的记录");
  const review = reviewSchema.parse(req.body);
  const config =
    store.getSetting<BaselineConfig>("baselineConfig") || defaultBaselineConfig;
  if (review.target !== config.brands[0].name)
    throw new Error("目标品牌已改变，请刷新后重新核对");
  if (review.top3 && new Set(review.top3).size !== review.top3.length)
    throw new Error("前三品牌不能重复");
  store.db
    .prepare(
      "INSERT INTO baseline_reviews(task_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
    )
    .run(task.id, JSON.stringify(review), new Date().toISOString());
  return { ok: true };
});
app.post("/api/batches", async (req) => {
  if (runner.busy || store.hasUnfinished())
    throw new Error("已有未完成任务，请先恢复、取消或完成当前批次");
  const body = z
    .object({
      platforms: z
        .array(platformSchema)
        .min(1)
        .default([...platformIds]),
      questionIds: z.array(z.number().int().positive()).min(1).optional(),
    })
    .parse(req.body || {});
  const batchId = await runner.create(
    [...new Set(body.platforms)],
    body.questionIds,
  );
  return { batchId };
});
app.post("/api/batches/retry-unfinished", async () => runner.retryUnfinished());
app.post("/api/pause", async () => {
  await runner.pause();
  return { ok: true };
});
app.post("/api/resume", async () => {
  await runner.resume();
  return { ok: true };
});
app.post<{ Params: { id: string } }>("/api/batches/:id/cancel", async (req) => {
  await runner.cancel(id(req.params.id));
  return { ok: true };
});
app.post<{ Params: { id: string } }>("/api/batches/:id/rerun", async (req) => ({
  batchId: await runner.rerun(id(req.params.id)),
}));
app.post<{ Params: { platform: string } }>(
  "/api/platforms/:platform/login",
  async (req) => {
    await runner.login(platformSchema.parse(req.params.platform));
    return { ok: true };
  },
);
app.post<{ Params: { platform: string } }>(
  "/api/platforms/:platform/resume",
  async (req) => {
    await runner.releasePlatform(platformSchema.parse(req.params.platform));
    return { ok: true };
  },
);
app.post<{ Params: { platform: string } }>(
  "/api/platforms/:platform/validate",
  (req) => {
    const p = platformSchema.parse(req.params.platform);
    if (store.tasks({ platform: p, status: "succeeded" }).length < 2)
      throw new Error("请先完成该平台至少两条成功采集，再核对回答与来源");
    store.validatePlatform(p);
    store.event("validation", `${platformNames[p]} 已人工核对，可参与定时采集`);
    return { ok: true };
  },
);
app.post<{ Params: { id: string } }>("/api/tasks/:id/retry", async (req) => ({
  batchId: await runner.retry(id(req.params.id)),
}));
app.post<{ Params: { id: string } }>("/api/tasks/:id/recover", async (req) => {
  await runner.recoverTask(id(req.params.id));
  return { ok: true };
});
app.post<{ Params: { id: string } }>("/api/tasks/:id/open", async (req) => {
  await runner.openConversation(id(req.params.id));
  return { ok: true };
});
app.get<{ Params: { id: string } }>("/api/tasks/:id/attempts", (req) =>
  store.attempts(id(req.params.id)),
);
app.patch("/api/settings", (req) => {
  const body = z
    .object({
      schedule: z
        .object({
          enabled: z.boolean(),
          frequency: z.enum(["weekly", "daily"]),
          weekday: z.number().int().min(0).max(6),
          hour: z.number().int().min(0).max(23),
          minute: z.number().int().min(0).max(59),
        })
        .optional(),
      allowAutoSearch: z.boolean().optional(),
      notifications: z.boolean().optional(),
      retryPolicy: retryPolicySchema.optional(),
    })
    .parse(req.body);
  if (body.schedule)
    store.setSetting("schedule", {
      ...body.schedule,
      timezone: "Asia/Shanghai",
      lastSlot: store.schedule.lastSlot,
    });
  if (body.allowAutoSearch !== undefined)
    store.setSetting("allowAutoSearch", body.allowAutoSearch);
  if (body.retryPolicy) store.setSetting("retryPolicy", body.retryPolicy);
  if (body.notifications !== undefined)
    store.setSetting("notifications", body.notifications);
  store.event("settings", "监测设置已保存");
  return { ok: true };
});
app.get<{ Params: { format: string } }>(
  "/api/export/:format",
  async (req, reply) => {
    const tasks = store.tasks(filters(req.query));
    const format = z
      .enum(["answers.csv", "sources.csv", "results.json"])
      .parse(req.params.format);
    reply.header(
      "Content-Disposition",
      `attachment; filename="seegeo-${format}"`,
    );
    if (format === "results.json")
      return reply.type("application/json; charset=utf-8").send(
        JSON.stringify(
          {
            schemaVersion: 2,
            exportedAt: new Date().toISOString(),
            batches: store.batches(),
            results: tasks.map(({ answer_html, ...t }) => ({
              ...t,
              attemptsLog: store.attempts(t.id),
            })),
          },
          null,
          2,
        ),
      );
    return reply
      .type("text/csv; charset=utf-8")
      .send(format === "answers.csv" ? answersCSV(tasks) : sourcesCSV(tasks));
  },
);
app.get<{ Params: { file: string } }>(
  "/api/diagnostics/:file",
  async (req, reply) => {
    if (!/^\d+-\d+\.png$/.test(req.params.file)) throw new Error("截图不存在");
    const path = join(dataDir, "diagnostics", req.params.file);
    if (!existsSync(path)) throw new Error("截图已过期或不存在");
    return reply.type("image/png").send(readFileSync(path));
  },
);
let shutting = false;
async function shutdown() {
  if (shutting) return;
  shutting = true;
  await runner.stop();
  await app.close();
  store.close();
  process.exit(0);
}
app.post("/api/shutdown", async (_req, reply) => {
  await reply.send({ ok: true });
  setTimeout(() => void shutdown(), 150);
});
const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
if (existsSync(root)) {
  await app.register(fastifyStatic, { root });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/")
      ? reply.code(404).send({ error: "接口不存在" })
      : reply.sendFile("index.html"),
  );
} else
  app.get("/", () => ({
    message: "服务已运行，面板尚未构建。运行 pnpm build，或启动 pnpm dev:ui。",
  }));
try {
  await app.listen({ host: "127.0.0.1", port });
  runner.start();
  console.log(
    `seegeo 已启动：http://127.0.0.1:${port}\n数据目录：${dataDir}\n关闭网页不会退出服务。按 Ctrl+C 或在面板退出。`,
  );
} catch (e) {
  store.close();
  console.error(
    (e as Error).message.includes("EADDRINUSE")
      ? "seegeo 已在运行，请打开现有面板。"
      : e,
  );
  process.exit(1);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
