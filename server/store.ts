import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { prepareDataDir, dataDir } from "./config.js";
import {
  platformIds,
  type Platform,
  type Question,
  type Task,
  type Schedule,
  type Capture,
} from "./types.js";

export class Store {
  db: DatabaseSync;
  private depth = 0;
  constructor(path?: string) {
    prepareDataDir();
    const databasePath = path || join(dataDir, "seegeo.sqlite");
    this.db = new DatabaseSync(databasePath);
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()!.user_version,
    );
    if (version > 5) throw new Error("数据库版本高于当前程序，请升级程序");
    if (version > 0 && version < 5 && databasePath !== ":memory:") {
      const backupDir = join(dirname(databasePath), "backups");
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      const backup = join(backupDir, `before-v5-${Date.now()}.sqlite`);
      this.db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      chmodSync(backup, 0o600);
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY, text TEXT NOT NULL, group_name TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
      CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY, trigger TEXT NOT NULL, scheduled_at TEXT, created_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id), question_id INTEGER NOT NULL REFERENCES questions(id), question_text TEXT NOT NULL, question_version INTEGER NOT NULL, group_name TEXT NOT NULL, platform TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'queued', answer TEXT, answer_html TEXT, sources TEXT NOT NULL DEFAULT '[]', source_status TEXT, model TEXT, mode TEXT, conversation_url TEXT, started_at TEXT, finished_at TEXT, error TEXT, diagnostic TEXT, UNIQUE(batch_id, question_id, platform));
      CREATE INDEX IF NOT EXISTS task_history ON tasks(question_id, platform, id DESC);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, type TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS validations(platform TEXT PRIMARY KEY, confirmed_at TEXT NOT NULL);
      `);
    if (version < 2)
      this.transaction(() => {
        this.db.exec(`
        ALTER TABLE batches ADD COLUMN control_state TEXT NOT NULL DEFAULT 'running';
        ALTER TABLE batches ADD COLUMN resume_task_id INTEGER;
        ALTER TABLE batches ADD COLUMN parent_batch_id INTEGER;
        ALTER TABLE tasks ADD COLUMN interruption_reason TEXT;
        ALTER TABLE tasks ADD COLUMN interrupted_at TEXT;
        CREATE TABLE task_attempts(id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, outcome TEXT, phase TEXT, conversation_url TEXT, error TEXT);
        UPDATE batches SET control_state='completed' WHERE finished_at IS NOT NULL;
        UPDATE tasks SET status='paused',interruption_reason='manual_pause',interrupted_at=COALESCE(started_at,datetime('now')) WHERE status='uncertain' AND error='任务已暂停，需核对原会话后继续';
        UPDATE batches SET control_state='paused',resume_task_id=(SELECT id FROM tasks WHERE batch_id=batches.id AND status='paused' ORDER BY interrupted_at DESC,id DESC LIMIT 1) WHERE finished_at IS NULL AND EXISTS(SELECT 1 FROM tasks WHERE batch_id=batches.id AND status='paused');
        PRAGMA user_version=2;
      `);
        if (this.getSetting("paused"))
          this.db.exec(
            "UPDATE batches SET control_state='paused' WHERE finished_at IS NULL",
          );
      });
    if (version < 3)
      this.transaction(() => {
        this.db.exec(
          "ALTER TABLE tasks ADD COLUMN deleted_at TEXT; PRAGMA user_version=3;",
        );
      });
    if (version < 4)
      this.transaction(() => {
        this.db.exec(
          "CREATE TABLE baseline_reviews(task_id INTEGER PRIMARY KEY REFERENCES tasks(id),payload TEXT NOT NULL,updated_at TEXT NOT NULL); PRAGMA user_version=4;",
        );
      });
    if (version < 5)
      this.transaction(() => {
        this.db.exec(
          "ALTER TABLE tasks ADD COLUMN retry_deadline_at TEXT; ALTER TABLE tasks ADD COLUMN automatic_retries INTEGER NOT NULL DEFAULT 0; PRAGMA user_version=5;",
        );
      });
    if (!this.getSetting("schedule"))
      this.setSetting("schedule", {
        enabled: true,
        frequency: "weekly",
        weekday: 1,
        hour: 9,
        minute: 0,
        timezone: "Asia/Shanghai",
        lastSlot: null,
      });
    if (this.getSetting("paused") === undefined)
      this.setSetting("paused", false);
  }
  close() {
    this.db.close();
  }
  getSetting<T = unknown>(key: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key);
    return row ? JSON.parse(String(row.value)) : undefined;
  }
  setSetting(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  transaction<T>(fn: () => T): T {
    const name = `nested_${this.depth}`;
    const nested = this.depth++ > 0;
    this.db.exec(nested ? `SAVEPOINT ${name}` : "BEGIN IMMEDIATE");
    try {
      const x = fn();
      this.db.exec(nested ? `RELEASE ${name}` : "COMMIT");
      return x;
    } catch (e) {
      this.db.exec(nested ? `ROLLBACK TO ${name}` : "ROLLBACK");
      if (nested) this.db.exec(`RELEASE ${name}`);
      throw e;
    } finally {
      this.depth--;
    }
  }
  questions() {
    return this.db
      .prepare(
        "SELECT * FROM questions WHERE deleted_at IS NULL ORDER BY id DESC",
      )
      .all() as unknown as Question[];
  }
  question(id: number) {
    return this.db
      .prepare("SELECT * FROM questions WHERE id=?")
      .get(id) as unknown as Question | undefined;
  }
  latestResults() {
    return this.db
      .prepare(
        "SELECT id,question_id,platform,status,finished_at,source_status,json_array_length(sources) sources_count FROM tasks WHERE id IN (SELECT MAX(id) FROM tasks WHERE deleted_at IS NULL GROUP BY question_id,platform)",
      )
      .all();
  }
  waitingCount(platform: Platform) {
    return Number(
      this.db
        .prepare(
          "SELECT COUNT(*) count FROM tasks WHERE platform=? AND status IN ('waiting_login','waiting_verification','uncertain')",
        )
        .get(platform)!.count,
    );
  }
  hasUnfinished() {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM tasks WHERE status IN ('pending','running','paused','waiting_login','waiting_verification','uncertain') LIMIT 1",
        )
        .get(),
    );
  }
  importQuestions(items: { text: string; group_name?: string }[]) {
    return this.transaction(() => {
      let added = 0,
        skipped = 0;
      const existing = new Set(this.questions().map((q) => q.text));
      for (const item of items) {
        const text = item.text.trim();
        if (!text || existing.has(text)) {
          skipped++;
          continue;
        }
        const now = new Date().toISOString();
        this.db
          .prepare(
            "INSERT INTO questions(text,group_name,created_at,updated_at) VALUES (?,?,?,?)",
          )
          .run(text, item.group_name?.trim() || "", now, now);
        existing.add(text);
        added++;
      }
      return { added, skipped };
    });
  }
  updateQuestion(
    id: number,
    patch: { text?: string; group_name?: string; enabled?: boolean },
  ) {
    const q = this.questions().find((q) => q.id === id);
    if (!q) throw new Error("问题不存在");
    const text = patch.text?.trim() ?? q.text;
    if (!text) throw new Error("问题不能为空");
    this.db
      .prepare(
        "UPDATE questions SET text=?,group_name=?,enabled=?,version=?,updated_at=? WHERE id=?",
      )
      .run(
        text,
        patch.group_name ?? q.group_name,
        patch.enabled === undefined ? q.enabled : Number(patch.enabled),
        q.version + Number(text !== q.text),
        new Date().toISOString(),
        id,
      );
  }
  deleteQuestion(id: number) {
    this.db
      .prepare("UPDATE questions SET deleted_at=?,enabled=0 WHERE id=?")
      .run(new Date().toISOString(), id);
  }
  deleteQuestions(ids: number[]) {
    return this.transaction(() => {
      const unique = [...new Set(ids)];
      const existing = new Set(this.questions().map((q) => q.id));
      if (unique.some((id) => !existing.has(id)))
        throw new Error("部分问题已不存在，请刷新列表后重试");
      for (const id of unique) this.deleteQuestion(id);
      return unique.length;
    });
  }
  deleteResults(ids: number[]) {
    return this.transaction(() => {
      const unique = [...new Set(ids)];
      const records = unique.map((id) => this.task(id));
      if (records.some((t) => !t))
        throw new Error("部分记录已不存在，请刷新列表后重试");
      if (records.some((t) => !this.batch(t!.batch_id)?.finished_at))
        throw new Error("请先完成或取消所属批次，再删除采集记录");
      const now = new Date().toISOString();
      for (const t of records) {
        this.db
          .prepare("DELETE FROM baseline_reviews WHERE task_id=?")
          .run(t!.id);
        // Retain only the question/platform snapshot for whole-batch reruns.
        this.db.prepare("DELETE FROM task_attempts WHERE task_id=?").run(t!.id);
        this.db
          .prepare(
            "UPDATE tasks SET deleted_at=?,answer=NULL,answer_html=NULL,sources='[]',source_status=NULL,model=NULL,mode=NULL,conversation_url=NULL,error=NULL,diagnostic=NULL WHERE id=?",
          )
          .run(now, t!.id);
      }
      this.event(
        "records",
        `删除 ${unique.length} 条采集记录；保留批次问题范围`,
      );
      return unique.length;
    });
  }
  createBatch(
    trigger: string,
    platforms: Platform[] = [...platformIds],
    questionIds?: number[],
    scheduledAt?: string,
  ) {
    return this.transaction(() => {
      const questions = this.questions().filter(
        (q) => q.enabled && (!questionIds || questionIds.includes(q.id)),
      );
      if (!questions.length)
        throw new Error("没有已启用的问题，请先导入并启用问题");
      const batch = this.db
        .prepare(
          "INSERT INTO batches(trigger,scheduled_at,created_at) VALUES (?,?,?)",
        )
        .run(trigger, scheduledAt || null, new Date().toISOString());
      const id = Number(batch.lastInsertRowid);
      const insert = this.db.prepare(
        "INSERT INTO tasks(batch_id,question_id,question_text,question_version,group_name,platform) VALUES (?,?,?,?,?,?)",
      );
      for (const q of questions)
        for (const platform of platforms)
          insert.run(id, q.id, q.text, q.version, q.group_name, platform);
      return id;
    });
  }
  tasks(
    filters: {
      batchId?: number;
      questionId?: number;
      platform?: string;
      status?: string;
      from?: string;
      to?: string;
      limit?: number;
      includeDeleted?: boolean;
    } = {},
  ) {
    const clauses: string[] = filters.includeDeleted
        ? []
        : ["deleted_at IS NULL"],
      params: (string | number)[] = [];
    for (const [key, col] of [
      ["batchId", "batch_id"],
      ["questionId", "question_id"],
      ["platform", "platform"],
      ["status", "status"],
    ] as const)
      if (filters[key] !== undefined && filters[key] !== "") {
        clauses.push(`${col}=?`);
        params.push(filters[key]!);
      }
    if (filters.from) {
      clauses.push("COALESCE(started_at, finished_at, '')>=?");
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push("COALESCE(started_at, finished_at, '')<=?");
      params.push(filters.to);
    }
    return this.db
      .prepare(
        `SELECT * FROM tasks ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY id DESC${filters.limit ? " LIMIT " + Math.max(1, Math.min(1000, Math.floor(filters.limit))) : ""}`,
      )
      .all(...params)
      .map((row) => ({
        ...row,
        sources: JSON.parse(String(row.sources)),
        mode: row.mode ? JSON.parse(String(row.mode)) : null,
      })) as unknown as Task[];
  }
  task(id: number) {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL")
      .get(id);
    return row
      ? ({
          ...row,
          sources: JSON.parse(String(row.sources)),
          mode: row.mode ? JSON.parse(String(row.mode)) : null,
        } as unknown as Task)
      : undefined;
  }
  activeBatch() {
    return this.batches().find((b) => !b.finished_at);
  }
  batch(id: number) {
    return this.batches().find((b) => b.id === id);
  }
  setBatchState(id: number, state: string, resumeId?: number | null) {
    this.db
      .prepare(
        "UPDATE batches SET control_state=?,resume_task_id=COALESCE(?,resume_task_id) WHERE id=?",
      )
      .run(state, resumeId ?? null, id);
  }
  cloneBatch(id: number, taskId?: number) {
    return this.transaction(() => {
      const tasks = this.tasks({ batchId: id, includeDeleted: true })
        .filter((t) => !taskId || t.id === taskId)
        .reverse();
      if (!tasks.length) throw new Error("批次不存在或没有任务");
      const result = this.db
        .prepare(
          "INSERT INTO batches(trigger,created_at,parent_batch_id) VALUES (?,?,?)",
        )
        .run(taskId ? "retry" : "rerun", new Date().toISOString(), id);
      const next = Number(result.lastInsertRowid);
      const insert = this.db.prepare(
        "INSERT INTO tasks(batch_id,question_id,question_text,question_version,group_name,platform) VALUES (?,?,?,?,?,?)",
      );
      for (const t of tasks)
        insert.run(
          next,
          t.question_id,
          t.question_text,
          t.question_version,
          t.group_name,
          t.platform,
        );
      return next;
    });
  }
  beginAttempt(taskId: number, kind: string) {
    return Number(
      this.db
        .prepare(
          "INSERT INTO task_attempts(task_id,kind,started_at) VALUES (?,?,?)",
        )
        .run(taskId, kind, new Date().toISOString()).lastInsertRowid,
    );
  }
  endAttempt(id: number, outcome: string, task: Task, error?: string) {
    this.db
      .prepare(
        "UPDATE task_attempts SET finished_at=?,outcome=?,phase=?,conversation_url=?,error=? WHERE id=?",
      )
      .run(
        new Date().toISOString(),
        outcome,
        task.phase,
        task.conversation_url,
        error || null,
        id,
      );
  }
  attempts(taskId: number) {
    return this.db
      .prepare("SELECT * FROM task_attempts WHERE task_id=? ORDER BY id")
      .all(taskId);
  }
  nextPending(blocked: string[]) {
    const batch = this.activeBatch();
    if (!batch || !["running"].includes(String(batch.control_state))) return;
    const tasks = this.tasks({ batchId: Number(batch.id) }).reverse();
    return tasks
      .filter(
        (t) =>
          ["pending", "paused"].includes(t.status) &&
          !blocked.includes(t.platform),
      )
      .sort(
        (a, b) =>
          Number(b.id === batch.resume_task_id) -
            Number(a.id === batch.resume_task_id) ||
          Number(b.status === "paused") - Number(a.status === "paused") ||
          a.id - b.id,
      )[0];
  }
  patchTask(id: number, patch: Partial<Omit<Task, "id">>) {
    const allowed = new Set([
      "status",
      "attempts",
      "phase",
      "answer",
      "answer_html",
      "sources",
      "source_status",
      "model",
      "mode",
      "conversation_url",
      "started_at",
      "finished_at",
      "error",
      "diagnostic",
      "retry_deadline_at",
      "automatic_retries",
      "interruption_reason",
      "interrupted_at",
    ]);
    const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
    if (!entries.length) return;
    this.db
      .prepare(
        `UPDATE tasks SET ${entries.map(([k]) => `${k}=?`).join(",")} WHERE id=?`,
      )
      .run(
        ...(entries.map(([k, v]) =>
          ["sources", "mode"].includes(k) && v !== null
            ? JSON.stringify(v)
            : (v ?? null),
        ) as (string | number | null)[]),
        id,
      );
  }
  completeTask(id: number, c: Capture) {
    this.patchTask(id, {
      status: c.sourceStatus === "failed" ? "partial" : "succeeded",
      phase: "completed",
      answer: c.answer,
      answer_html: c.html,
      sources: c.sources,
      source_status: c.sourceStatus,
      model: c.model,
      mode: c.mode,
      conversation_url: c.conversationUrl,
      started_at: c.startedAt,
      finished_at: c.finishedAt,
      error:
        c.sourceStatus === "failed"
          ? "回答已保存，但来源提取未完成，请核对原会话"
          : null,
    });
  }
  batches() {
    return this.db
      .prepare(
        `SELECT b.*, COUNT(t.id) total, SUM(t.status='succeeded') succeeded, SUM(t.status='partial') partial, SUM(t.status='failed') failed, SUM(t.status IN ('waiting_login','waiting_verification','uncertain')) waiting, SUM(t.status='paused') paused, SUM(t.status='running') running, SUM(t.status='pending') pending, SUM(t.status='skipped') skipped, SUM(t.status='cancelled') cancelled, SUM(t.deleted_at IS NOT NULL) removed FROM batches b LEFT JOIN tasks t ON t.batch_id=b.id GROUP BY b.id ORDER BY b.id DESC`,
      )
      .all();
  }
  recover() {
    const running = this.tasks({ status: "running" });
    for (const t of running) {
      this.patchTask(t.id, {
        status: ["submitting", "submitted", "extracting"].includes(t.phase)
          ? "uncertain"
          : "pending",
        error: ["submitting", "submitted", "extracting"].includes(t.phase)
          ? "服务上次在提交或生成期间退出，请核对原会话后再恢复"
          : null,
        interruption_reason: "unexpected_exit",
        interrupted_at: new Date().toISOString(),
      });
      this.setBatchState(t.batch_id, "paused", t.id);
      this.setSetting("paused", true);
    }
    this.db.exec(
      "UPDATE task_attempts SET outcome='interrupted',finished_at=datetime('now') WHERE finished_at IS NULL",
    );
    for (const b of this.batches()) {
      if (b.control_state === "pausing")
        this.setBatchState(Number(b.id), "paused");
      if (b.control_state === "cancelling") {
        this.db
          .prepare(
            "UPDATE tasks SET status='cancelled',interruption_reason='user_cancel',finished_at=? WHERE batch_id=? AND status NOT IN ('succeeded','partial','failed','cancelled')",
          )
          .run(new Date().toISOString(), b.id);
        this.db
          .prepare(
            "UPDATE batches SET control_state='cancelled',finished_at=? WHERE id=?",
          )
          .run(new Date().toISOString(), b.id);
      }
    }
  }
  event(type: string, message: string) {
    this.db
      .prepare("INSERT INTO events(type,message,created_at) VALUES (?,?,?)")
      .run(type, message, new Date().toISOString());
  }
  events() {
    return this.db
      .prepare("SELECT * FROM events ORDER BY id DESC LIMIT 100")
      .all();
  }
  get schedule() {
    return this.getSetting<Schedule>("schedule")!;
  }
  validatedPlatforms(): Platform[] {
    return this.db
      .prepare("SELECT platform FROM validations")
      .all()
      .map((r) => r.platform as Platform);
  }
  validatePlatform(platform: Platform) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO validations(platform,confirmed_at) VALUES (?,?)",
      )
      .run(platform, new Date().toISOString());
  }
}
