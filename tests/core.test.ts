import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { latestSlot, nextSlot } from "../server/schedule.js";
import { parseQuestions, answersCSV } from "../server/import-export.js";
import type { Schedule } from "../server/types.js";

const weekly: Schedule = {
  enabled: true,
  frequency: "weekly",
  weekday: 1,
  hour: 9,
  minute: 0,
  timezone: "Asia/Shanghai",
  lastSlot: null,
};
test("Shanghai weekly slots handle before/at boundary, restart and multiple missed weeks", () => {
  assert.equal(
    latestSlot(weekly, new Date("2026-10-26T00:59:59Z")),
    "2026-10-19T01:00:00.000Z",
  );
  assert.equal(
    latestSlot(weekly, new Date("2026-10-26T01:00:00Z")),
    "2026-10-26T01:00:00.000Z",
  );
  assert.equal(
    latestSlot(weekly, new Date("2026-11-15T15:00:00Z")),
    "2026-11-09T01:00:00.000Z",
  );
  assert.equal(
    nextSlot(weekly, new Date("2026-10-26T01:00:00Z")),
    "2026-11-02T01:00:00.000Z",
  );
});
test("daily schedule uses Shanghai midnight and custom time", () => {
  const daily = { ...weekly, frequency: "daily" as const, hour: 0, minute: 15 };
  assert.equal(
    latestSlot(daily, new Date("2026-10-25T16:14:00Z")),
    "2026-10-24T16:15:00.000Z",
  );
  assert.equal(
    latestSlot(daily, new Date("2026-10-25T16:15:00Z")),
    "2026-10-25T16:15:00.000Z",
  );
});
test("CSV imports BOM, Chinese headers, commas, quoted multiline questions and grouping", () => {
  const items = parseQuestions(
    '\uFEFF问题,分组\r\n"含逗号,的问题",行业\r\n"第一行\n第二行",品牌\r\n',
    "csv",
  );
  assert.deepEqual(items, [
    { text: "含逗号,的问题", group_name: "行业" },
    { text: "第一行\n第二行", group_name: "品牌" },
  ]);
  assert.deepEqual(parseQuestions("a\n\nb", "text", "组"), [
    { text: "a", group_name: "组" },
    { text: "b", group_name: "组" },
  ]);
});
test("question edits preserve historical snapshots and soft deletion preserves answers", () => {
  const s = new Store(":memory:");
  assert.deepEqual(
    s.importQuestions([{ text: "原问题" }, { text: "原问题" }, { text: "  " }]),
    { added: 1, skipped: 2 },
  );
  const q = s.questions()[0];
  const b = s.createBatch("manual", ["deepseek"]);
  s.updateQuestion(q.id, { text: "新问题", group_name: "新组" });
  assert.equal(s.tasks({ batchId: b })[0].question_text, "原问题");
  assert.equal(s.questions()[0].version, 2);
  s.deleteQuestion(q.id);
  assert.equal(s.questions().length, 0);
  assert.equal(s.tasks({ batchId: b }).length, 1);
  s.close();
});
test("recovery never automatically resubmits tasks interrupted during send or generation", () => {
  const s = new Store(":memory:");
  s.importQuestions([{ text: "q1" }, { text: "q2" }, { text: "q3" }]);
  s.createBatch("manual", ["deepseek"]);
  const tasks = s.tasks();
  s.patchTask(tasks[0].id, { status: "running", phase: "opening" });
  s.patchTask(tasks[1].id, { status: "running", phase: "submitting" });
  s.patchTask(tasks[2].id, { status: "running", phase: "submitted" });
  s.recover();
  assert.equal(s.task(tasks[0].id)?.status, "pending");
  assert.equal(s.task(tasks[1].id)?.status, "uncertain");
  assert.equal(s.task(tasks[2].id)?.status, "uncertain");
  s.close();
});
test("scheduled batch creation and cursor update are atomic, including nested transactions", () => {
  const s = new Store(":memory:");
  s.importQuestions([{ text: "q" }]);
  assert.throws(() =>
    s.transaction(() => {
      s.createBatch(
        "schedule",
        ["deepseek"],
        undefined,
        "2026-10-26T01:00:00Z",
      );
      s.setSetting("cursor", "bad");
      throw new Error("crash");
    }),
  );
  assert.equal(s.tasks().length, 0);
  assert.equal(s.getSetting("cursor"), undefined);
  s.transaction(() => {
    s.createBatch("schedule", ["deepseek"]);
    s.setSetting("cursor", "good");
  });
  assert.equal(s.tasks().length, 1);
  s.close();
});
test("a completed answer with failed source extraction is partial, never success or no sources", () => {
  const s = new Store(":memory:");
  s.importQuestions([{ text: "q" }]);
  s.createBatch("manual", ["deepseek"]);
  const t = s.tasks()[0];
  s.completeTask(t.id, {
    answer: "原文",
    html: "<p>原文</p>",
    sources: [],
    sourceStatus: "failed",
    model: null,
    mode: { search: "enabled", thinking: false, searchTriggered: true },
    conversationUrl: "https://chat.deepseek.com/a/chat/s/test",
    startedAt: "2026-10-26T01:00:00Z",
    finishedAt: "2026-10-26T01:01:00Z",
  });
  assert.equal(s.task(t.id)?.status, "partial");
  assert.equal(s.task(t.id)?.source_status, "failed");
  const csv = answersCSV([
    {
      ...s.task(t.id)!,
      answer: '=HYPERLINK("https://example.com")\n中文,"引号"',
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('""引号""'));
  s.close();
});

test("v1迁移备份数据库并将三条手动暂停遗留项纳入恢复，旧答案保留", async () => {
  const { mkdtempSync, readdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "seegeo-migration-")),
    path = join(dir, "seegeo.sqlite");
  let store = new Store(path);
  store.importQuestions([{ text: "历史问题" }]);
  const b = store.createBatch("manual");
  for (const t of store.tasks())
    store.patchTask(t.id, {
      status: "uncertain",
      phase: "submitted",
      error: "任务已暂停，需核对原会话后继续",
      answer: "暂存回答",
    });
  store.setSetting("paused", true);
  store.db.exec(
    "DROP TABLE baseline_snapshots; DROP TABLE publication_links; DROP TABLE publication_channels; ALTER TABLE tasks DROP COLUMN source_task_id; DROP TABLE task_attempts; DROP TABLE baseline_reviews; ALTER TABLE tasks DROP COLUMN retry_deadline_at; ALTER TABLE tasks DROP COLUMN automatic_retries; ALTER TABLE tasks DROP COLUMN deleted_at; ALTER TABLE batches DROP COLUMN control_state; ALTER TABLE batches DROP COLUMN resume_task_id; ALTER TABLE batches DROP COLUMN parent_batch_id; ALTER TABLE tasks DROP COLUMN interruption_reason; ALTER TABLE tasks DROP COLUMN interrupted_at; PRAGMA user_version=1;",
  );
  store.close();
  store = new Store(path);
  assert.equal(store.tasks({ status: "paused" }).length, 3);
  assert.ok(
    store
      .tasks()
      .every(
        (t) =>
          t.answer === "暂存回答" && t.interruption_reason === "manual_pause",
      ),
  );
  assert.equal(store.batch(b)?.control_state, "paused");
  assert.equal(store.getSetting("paused"), true);
  assert.equal(readdirSync(join(dir, "backups")).length, 1);
  store.close();
  store = new Store(path);
  assert.equal(readdirSync(join(dir, "backups")).length, 1);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("批量移除校验完整范围、去重并保留历史快照和已保存答案", () => {
  const s = new Store(":memory:");
  s.importQuestions([
    { text: "保留历史甲" },
    { text: "移除乙" },
    { text: "保留丙" },
  ]);
  const ids = s.questions().map((q) => q.id),
    batch = s.createBatch("manual", ["doubao"]);
  const task = s
    .tasks({ batchId: batch })
    .find((t) => t.question_id === ids[0])!;
  s.patchTask(task.id, {
    answer: "历史回答",
    sources: [
      {
        kind: "citation",
        url: "https://example.com/source",
        title: "旧来源",
        site: "example.com",
        order: 1,
        snippet: "",
      },
    ],
  });
  assert.throws(() => s.deleteQuestions([ids[0], 9999]), /不存在/);
  assert.equal(s.questions().length, 3, "范围无效时不能部分删除");
  assert.equal(s.deleteQuestions([ids[0], ids[1], ids[0]]), 2);
  assert.deepEqual(
    s.questions().map((q) => q.id),
    [ids[2]],
  );
  assert.equal(s.task(task.id)?.answer, "历史回答");
  assert.equal(s.task(task.id)?.sources[0].title, "旧来源");
  assert.equal(s.tasks({ batchId: batch }).length, 3);
  assert.ok(s.question(ids[0]));
  s.close();
});

test("采集记录批量删除清除答案来源和尝试，保留整轮重跑范围并拒绝未结束批次", () => {
  const s = new Store(":memory:");
  s.importQuestions([{ text: "历史甲" }, { text: "历史乙" }]);
  const b = s.createBatch("manual", ["doubao"]);
  const tasks = s.tasks({ batchId: b });
  s.patchTask(tasks[0].id, {
    answer: "历史正文",
    sources: [
      {
        kind: "citation",
        url: "https://example.com",
        title: "来源",
        site: "example.com",
        order: 1,
        snippet: "",
      },
    ],
  });
  assert.throws(() => s.deleteResults([tasks[0].id]), /完成或取消/);
  assert.equal(s.task(tasks[0].id)?.answer, "历史正文");
  s.db
    .prepare("UPDATE batches SET finished_at=? WHERE id=?")
    .run(new Date().toISOString(), b);
  s.beginAttempt(tasks[0].id, "collect");
  assert.equal(s.deleteResults([tasks[0].id, tasks[0].id]), 1);
  assert.equal(s.task(tasks[0].id), undefined);
  assert.equal(s.tasks({ batchId: b }).length, 1);
  assert.equal(s.attempts(tasks[0].id).length, 0);
  assert.equal(
    s
      .tasks({ batchId: b, includeDeleted: true })
      .find((t) => t.id === tasks[0].id)?.answer,
    null,
  );
  assert.equal(s.latestResults().length, 1);
  const next = s.cloneBatch(b);
  assert.equal(s.tasks({ batchId: next }).length, 2);
  assert.equal(s.questions().length, 2);
  s.close();
});
test("新批次按问题轮换三平台，减少连续平台请求且保留矩阵范围", () => {
  const s = new Store(":memory:");
  s.importQuestions([{ text: "问题甲" }, { text: "问题乙" }]);
  const b = s.createBatch("manual");
  assert.deepEqual(
    s
      .tasks({ batchId: b })
      .reverse()
      .map((t) => t.platform),
    ["doubao", "deepseek", "yuanbao", "doubao", "deepseek", "yuanbao"],
  );
  s.close();
});
