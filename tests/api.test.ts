import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { Store } from "../server/store.js";
let child: ChildProcess, base: string, token: string, questionId: number;
const dir = mkdtempSync(join(tmpdir(), "seegeo-api-"));
async function request(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-Seegeo-Token": token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json() };
}
before(async () => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((r) => socket.close(() => r()));
  base = `http://127.0.0.1:${port}/api`;
  child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, SEEGEO_DATA_DIR: dir, SEEGEO_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + "/state");
      if (r.ok) {
        token = (await r.json()).token;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(token, "隔离测试服务应启动");
  await request("/pause", {});
});
after(async () => {
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "close");
  }
  rmSync(dir, { recursive: true, force: true });
});
test("local mutation token and origin checks reject unauthenticated/cross-site requests", async () => {
  const noToken = await fetch(base + "/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(noToken.status, 403);
  const foreign = await fetch(base + "/resume", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Seegeo-Token": token,
      Origin: "https://untrusted.example",
    },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
});
test("question import, version update and schedule settings round-trip through actual HTTP API", async () => {
  const r = await request("/questions/import", {
    format: "csv",
    content: '问题,分组\n"问题,甲",行业\n问题乙,品牌\n"问题,甲",行业',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { added: 2, skipped: 1 });
  const questions = (await request("/questions")).data;
  questionId = questions.find((q: any) => q.text === "问题,甲").id;
  await request("/questions/" + questionId, { text: "新问题甲" }, "PATCH");
  assert.equal((await request("/questions/" + questionId)).data.version, 2);
  const result = await request(
    "/settings",
    {
      schedule: {
        enabled: false,
        frequency: "daily",
        weekday: 1,
        hour: 20,
        minute: 30,
      },
    },
    "PATCH",
  );
  assert.equal(result.status, 200);
  const state = (await request("/state")).data;
  assert.equal(state.schedule.hour, 20);
  assert.equal(state.schedule.timezone, "Asia/Shanghai");
  assert.equal(state.paused, true);
});
test("exports keep source associations, safe CSV and complete JSON; archived questions remain readable", async () => {
  const store = new Store(join(dir, "seegeo.sqlite"));
  const batch = store.createBatch("test", ["deepseek"], [questionId]);
  const task = store.tasks({ batchId: batch })[0];
  store.completeTask(task.id, {
    answer: '=原始回答\n中文,"引号"',
    html: "<p>原始回答</p>",
    model: null,
    mode: { search: "enabled", thinking: false, searchTriggered: true },
    sourceStatus: "extracted",
    sources: [
      {
        kind: "citation",
        url: "https://source.example/article",
        title: "来源标题",
        site: "source.example",
        order: 1,
        snippet: "摘要",
        marker: "1",
      },
    ],
    conversationUrl: "https://chat.deepseek.com/a/chat/s/test",
    startedAt: "2026-10-26T01:00:00.000Z",
    finishedAt: "2026-10-26T01:00:10.000Z",
  });
  store.close();
  const rows = (await request("/results?platform=deepseek&status=succeeded"))
    .data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sources[0].title, "来源标题");
  assert.equal(rows[0].answer_html, "<p>原始回答</p>");
  const exported = (
    await request("/export/results.json?questionId=" + questionId)
  ).data;
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.results[0].answer, '=原始回答\n中文,"引号"');
  assert.equal(exported.batches[0].id, batch);
  const csv = await (await fetch(base + "/export/answers.csv")).text();
  assert.ok(csv.includes("'=原始回答"));
  assert.ok(csv.includes('""引号""'));
  assert.equal(
    (await request("/questions/" + questionId, undefined, "DELETE")).status,
    200,
  );
  assert.equal(
    (await request("/questions")).data.some((q: any) => q.id === questionId),
    false,
  );
  assert.equal(
    (await request("/questions/" + questionId)).data.text,
    "新问题甲",
  );
  assert.equal(
    (await request("/results?questionId=" + questionId)).data.length,
    1,
  );
});
test("批次取消接口可在暂停状态直接调用，保留成功结果并立即开放开始操作", async () => {
  const state = (await request("/state")).data;
  assert.ok(state.controls);
  const batch = state.batches[0].id;
  const before = (await request("/results")).data;
  assert.equal((await request(`/batches/${batch}/cancel`, {})).status, 200);
  assert.equal((await request(`/batches/${batch}/cancel`, {})).status, 200);
  const after = (await request("/state")).data;
  assert.equal(after.activeBatch, null);
  assert.equal(after.controls.start.enabled, true);
  assert.equal(after.paused, false);
  assert.deepEqual(
    (await request("/results")).data.map(({ can_delete, ...t }: any) => t),
    before.map(({ can_delete, ...t }: any) => t),
  );
});

test("批量删除API验证空列表与非法范围，成功后只移出问题库", async () => {
  await request("/questions/import", {
    format: "text",
    content: "批量删除甲\n批量删除乙",
  });
  const questions = (await request("/questions")).data;
  const ids = questions
    .filter((q: any) => q.text.startsWith("批量删除"))
    .map((q: any) => q.id);
  assert.equal(ids.length, 2);
  assert.equal(
    (await request("/questions/bulk-delete", { questionIds: [] })).status,
    400,
  );
  assert.equal(
    (await request("/questions/bulk-delete", { questionIds: [ids[0], 999999] }))
      .status,
    404,
  );
  assert.equal((await request("/questions")).data.length, questions.length);
  const result = await request("/questions/bulk-delete", {
    questionIds: [...ids, ids[0]],
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.removed, 2);
  assert.ok(
    !(await request("/questions")).data.some((q: any) => ids.includes(q.id)),
  );
  assert.equal((await request("/questions/" + ids[0])).data.enabled, 0);
  assert.equal(
    (await request("/state")).data.version,
    JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).version,
  );
});
test("采集记录批量删除API拒绝非法范围，并从详情、导出和最新结果移除", async () => {
  const rows = (await request("/results")).data;
  const task = rows[0];
  assert.ok(task);
  assert.equal(
    (await request("/results/bulk-delete", { taskIds: [] })).status,
    400,
  );
  assert.equal(
    (await request("/results/bulk-delete", { taskIds: [task.id, 999999] }))
      .status,
    404,
  );
  assert.equal((await request("/results/" + task.id)).status, 200);
  const count = (await request("/questions")).data.length;
  assert.equal(
    (await request("/results/bulk-delete", { taskIds: [task.id] })).data
      .removed,
    1,
  );
  assert.equal((await request("/results/" + task.id)).status, 404);
  assert.equal((await request("/export/results.json")).data.results.length, 0);
  assert.equal((await request("/questions")).data.length, count);
});
test("基线API配置重算历史、记录核对、分平台时间筛选、导出和删除联动", async () => {
  const s = new Store(join(dir, "seegeo.sqlite"));
  s.importQuestions([{ text: "品牌测试", group_name: "基线" }]);
  const q = s.questions().find((q) => q.text === "品牌测试")!;
  const b = s.createBatch("test", ["doubao"], [q.id]);
  const t = s.tasks({ batchId: b })[0];
  s.completeTask(t.id, {
    answer: "1. 鑫君威\n2. 三棵树\n3. 嘉宝莉",
    html: "<p>鑫君威</p>",
    sources: [
      {
        kind: "citation",
        url: "https://source.example/a",
        site: "source.example",
        title: "来源",
        order: 1,
        snippet: "",
      },
    ],
    sourceStatus: "extracted",
    mode: { search: "auto", thinking: false, searchTriggered: true },
    model: null,
    conversationUrl: "https://www.doubao.com/chat/123",
    startedAt: "2026-10-26T01:00:00.000Z",
    finishedAt: "2026-10-26T01:01:00.000Z",
  });
  s.db
    .prepare(
      "UPDATE batches SET finished_at=?,control_state='completed' WHERE id=?",
    )
    .run(new Date().toISOString(), b);
  s.close();
  assert.equal((await request("/baseline")).data.scope.answers, 1);
  assert.equal(
    (await request("/baseline?platform=deepseek")).data.scope.answers,
    0,
  );
  assert.equal(
    (await request("/baseline?from=2026-10-27T00:00:00Z")).data.scope.answers,
    0,
  );
  const config = {
    brands: [
      { name: "鑫君威", aliases: ["XJW"] },
      { name: "三棵树", aliases: [] },
      { name: "嘉宝莉", aliases: [] },
    ],
  };
  assert.equal(
    (await request("/baseline/config", config, "PATCH")).status,
    200,
  );
  const bad = await request(
    "/baseline/config",
    {
      brands: [
        { name: "甲", aliases: ["相同"] },
        { name: "乙", aliases: ["相同"] },
      ],
    },
    "PATCH",
  );
  assert.equal(bad.status, 400);
  assert.equal(
    (
      await request(
        `/baseline/reviews/${t.id}`,
        {
          target: "鑫君威",
          sentiment: "positive",
          top3: ["鑫君威", "三棵树"],
          note: "人工核对",
        },
        "PUT",
      )
    ).status,
    200,
  );
  let r = (await request("/baseline")).data;
  assert.equal(r.sentiment.positive, 1);
  assert.equal(r.brands[0].top3Rate, 1);
  assert.equal(r.websites[0].share, 1);
  await request(
    "/baseline/config",
    { brands: [{ name: "嘉宝莉", aliases: [] }, ...config.brands.slice(0, 2)] },
    "PATCH",
  );
  r = (await request("/baseline/export")).data;
  assert.equal(r.scope.target, "嘉宝莉");
  assert.equal(r.sentiment.positive, 0);
  assert.equal(r.sentiment.unreviewed, 1);
  assert.equal(
    (
      await request(
        `/baseline/reviews/${t.id}`,
        { target: "鑫君威", sentiment: "negative" },
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (await request("/results/bulk-delete", { taskIds: [t.id] })).status,
    200,
  );
  assert.equal((await request("/baseline")).data.scope.answers, 0);
  const check = new Store(join(dir, "seegeo.sqlite"));
  assert.equal(
    check.db.prepare("SELECT count(*) count FROM baseline_reviews").get()!
      .count,
    0,
  );
  check.close();
});
