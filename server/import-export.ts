import { parse } from "csv-parse/sync";
import type { Task } from "./types.js";
export function parseQuestions(
  content: string,
  format: "text" | "csv",
  group = "",
) {
  if (format === "text")
    return content
      .split(/\r?\n/)
      .filter((s) => s.trim())
      .map((text) => ({ text: text.trim(), group_name: group }));
  const rows = parse(content, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as string[][];
  if (!rows.length) return [];
  const header = rows[0];
  const qi = header.findIndex((s) =>
    /^(问题|问题文本|question|text)$/i.test(s),
  );
  const gi = header.findIndex((s) => /^(分组|组名|group|group_name)$/i.test(s));
  return (qi >= 0 ? rows.slice(1) : rows)
    .filter((r) => r[qi >= 0 ? qi : 0]?.trim())
    .map((r) => ({
      text: r[qi >= 0 ? qi : 0],
      group_name: gi >= 0 ? r[gi] || group : group,
    }));
}
function csvCell(value: unknown) {
  let s = value == null ? "" : String(value);
  // Spreadsheet applications must not execute a collected answer as a formula.
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function csv(rows: unknown[][]) {
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
export function answersCSV(tasks: Task[]) {
  return csv([
    [
      "任务ID",
      "批次ID",
      "问题ID",
      "问题版本",
      "问题",
      "分组",
      "平台",
      "状态",
      "实际开始时间",
      "实际完成时间",
      "模型",
      "模式",
      "回答",
      "来源状态",
      "会话链接",
      "错误",
    ],
    ...tasks.map((t) => [
      t.id,
      t.batch_id,
      t.question_id,
      t.question_version,
      t.question_text,
      t.group_name,
      t.platform,
      t.status,
      t.started_at,
      t.finished_at,
      t.model,
      JSON.stringify(t.mode),
      t.answer,
      t.source_status,
      t.conversation_url,
      t.error,
    ]),
  ]);
}
export function sourcesCSV(tasks: Task[]) {
  return csv([
    [
      "任务ID",
      "问题",
      "平台",
      "类型",
      "顺序",
      "标题",
      "链接",
      "站点",
      "摘要",
      "引用编号",
      "对应正文",
    ],
    ...tasks.flatMap((t) =>
      t.sources.map((s) => [
        t.id,
        t.question_text,
        t.platform,
        s.kind,
        s.order,
        s.title,
        s.url,
        s.site,
        s.snippet,
        s.marker,
        s.passage,
      ]),
    ),
  ]);
}
