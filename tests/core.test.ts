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
