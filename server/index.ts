import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
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

const app = Fastify({ bodyLimit: 2 * 1024 * 1024 });
const token = randomBytes(24).toString("hex");
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
  paused: store.getSetting("paused") || false,
  busy: runner.busy,
  currentTask: runner.current,
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
app.get("/api/results", (req) =>
  store.tasks({ ...filters(req.query), limit: 500 }),
);
app.get<{ Params: { id: string } }>("/api/results/:id", (req) => {
  const task = store.task(id(req.params.id));
  if (!task) throw new Error("结果不存在");
  return task;
});
app.post("/api/batches", (req) => {
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
  const batchId = store.createBatch(
    "manual",
    [...new Set(body.platforms)],
    body.questionIds,
  );
  runner.resume();
  return { batchId };
});
app.post("/api/pause", () => {
  runner.pause();
  return { ok: true };
});
app.post("/api/resume", () => {
  runner.resume();
  return { ok: true };
});
app.post<{ Params: { id: string } }>("/api/batches/:id/cancel", (req) => {
  const batchId = id(req.params.id);
  if (runner.busy) throw new Error("请先暂停并等待当前任务停止");
  for (const t of store.tasks({ batchId }))
    if (
      [
        "pending",
        "waiting_login",
        "waiting_verification",
        "uncertain",
      ].includes(t.status)
    )
      store.patchTask(t.id, {
        status: "cancelled",
        finished_at: new Date().toISOString(),
        error: t.status === "uncertain" ? "用户取消；原会话可能仍有回答" : null,
      });
  runner.finishBatch(batchId);
  for (const p of platformIds) runner.releasePlatform(p);
  return { ok: true };
});
app.post<{ Params: { platform: string } }>(
  "/api/platforms/:platform/login",
  async (req) => {
    const p = platformSchema.parse(req.params.platform);
    if (runner.busy) throw new Error("请先暂停任务，避免登录操作影响当前会话");
    runner.busy = true;
    try {
      await runner.browsers.login(p);
      return { ok: true };
    } finally {
      runner.busy = false;
    }
  },
);
app.post<{ Params: { platform: string } }>(
  "/api/platforms/:platform/resume",
  (req) => {
    runner.releasePlatform(platformSchema.parse(req.params.platform));
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
app.post<{ Params: { id: string } }>("/api/tasks/:id/retry", (req) => {
  const batchId = runner.retry(id(req.params.id));
  return { batchId };
});
app.post<{ Params: { id: string } }>("/api/tasks/:id/recover", async (req) => {
  if (runner.busy) throw new Error("请先暂停并等待当前任务停止");
  const task = store.task(id(req.params.id));
  if (
    !task ||
    !["uncertain", "partial", "waiting_verification", "waiting_login"].includes(
      task.status,
    ) ||
    !task.conversation_url ||
    !task.mode
  )
    throw new Error("缺少可核对的原会话或模式，请先人工查看原会话");
  const page = await runner.browsers.page(task.platform);
  const expectedHost = new URL(
    task.platform === "doubao"
      ? "https://www.doubao.com"
      : task.platform === "deepseek"
        ? "https://chat.deepseek.com"
        : "https://yuanbao.tencent.com",
  ).hostname;
  if (new URL(task.conversation_url).hostname !== expectedHost)
    throw new Error("原会话地址不属于该平台");
  await page.goto(task.conversation_url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  try {
    const capture = await recoverExisting(
      page,
      task.platform,
      task.question_text,
      task.mode,
      task.model,
      task.started_at || undefined,
    );
    store.completeTask(task.id, capture);
    runner.releasePlatform(task.platform);
    runner.finishBatch(task.batch_id);
    return { ok: true };
  } catch (e) {
    if (e instanceof CollectorError) throw new Error(e.message);
    throw e;
  }
});
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
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            batches: store.batches(),
            results: tasks.map(({ answer_html, ...t }) => t),
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
