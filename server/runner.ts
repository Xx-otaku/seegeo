import { spawn, execFile, type ChildProcess } from "node:child_process";
import { readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./store.js";
import { BrowserPool } from "./browser.js";
import { collect } from "./collector.js";
import {
  CollectorError,
  platformIds,
  platformNames,
  type Task,
} from "./types.js";
import { latestSlot } from "./schedule.js";
import { dataDir } from "./config.js";

export class Runner {
  busy = false;
  current: number | null = null;
  private controller: AbortController | null = null;
  private awake: ChildProcess | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private blocked = new Set<string>();
  private stopping = false;
  constructor(
    public store: Store,
    public browsers = new BrowserPool(),
  ) {}
  start() {
    this.store.recover();
    for (const t of this.store.tasks())
      if (
        ["waiting_login", "waiting_verification", "uncertain"].includes(
          t.status,
        )
      )
        this.blocked.add(t.platform);
    this.cleanup();
    this.interval = setInterval(
      () => this.tick().catch((e) => this.store.event("error", String(e))),
      15000,
    );
    void this.tick();
  }
  notify(type: string, message: string) {
    this.store.event(type, message);
    if (
      process.platform === "darwin" &&
      this.store.getSetting("notifications") !== false
    )
      execFile(
        "/usr/bin/osascript",
        [
          "-e",
          `display notification ${JSON.stringify(message)} with title "seegeo"`,
        ],
        () => {},
      );
  }
  async tick(now = new Date()) {
    if (this.stopping || this.busy || this.store.getSetting("paused")) return;
    const schedule = this.store.schedule;
    // First-run validation must precede unattended collection.
    if (
      schedule.enabled &&
      this.store.validatedPlatforms().length === platformIds.length &&
      this.store.questions().some((q) => q.enabled)
    ) {
      const slot = latestSlot(schedule, now);
      if (!schedule.lastSlot || slot > schedule.lastSlot) {
        this.store.transaction(() => {
          // An unfinished batch absorbs a missed slot; never accumulate stale batches.
          if (!this.store.hasUnfinished())
            this.store.createBatch(
              "schedule",
              [...platformIds],
              undefined,
              slot,
            );
          this.store.setSetting("schedule", { ...schedule, lastSlot: slot });
        });
      }
    }
    await this.work();
  }
  async work() {
    if (this.busy || this.store.getSetting("paused")) return;
    this.busy = true;
    if (process.platform === "darwin") {
      this.awake = spawn("/usr/bin/caffeinate", ["-i"]);
      this.awake.on("error", () => {});
    }
    try {
      while (!this.stopping && !this.store.getSetting("paused")) {
        const task = this.store.nextPending([...this.blocked]);
        if (!task) break;
        this.current = task.id;
        this.controller = new AbortController();
        this.store.patchTask(task.id, {
          status: "running",
          attempts: task.attempts + 1,
          started_at: new Date().toISOString(),
          error: null,
        });
        let page;
        try {
          page = await this.browsers.page(task.platform);
          const result = await collect(
            page,
            task.platform,
            task.question_text,
            (phase, details) =>
              this.store.patchTask(task.id, {
                phase,
                conversation_url: page!.url(),
                ...(details || {}),
              }),
            this.controller.signal,
            {
              allowAutoSearch:
                this.store.getSetting("allowAutoSearch") === true,
              timeoutMs: 300000,
            },
          );
          this.store.completeTask(task.id, result);
          const prior = this.store
            .tasks({ questionId: task.question_id, platform: task.platform })
            .find(
              (t) => t.id !== task.id && t.status === "succeeded" && t.model,
            );
          if (prior?.model && result.model && prior.model !== result.model)
            this.notify(
              "model_change",
              `${platformNames[task.platform]} 的可见模型由 ${prior.model} 变为 ${result.model}`,
            );
        } catch (error) {
          const e =
            error instanceof CollectorError
              ? error
              : new CollectorError(String(error), "uncertain", true);
          const diagnostic = await this.diagnostic(task, page, e);
          let status: Task["status"] = "failed";
          if (e.kind === "login") status = "waiting_login";
          else if (e.kind === "verification") status = "waiting_verification";
          else if (e.submitted) status = "uncertain";
          else if (e.kind === "cancelled") status = "pending";
          else if (e.kind === "network" && task.attempts < 1)
            status = "pending";
          this.store.patchTask(task.id, {
            status,
            error: e.message,
            diagnostic,
            finished_at: ["failed"].includes(status)
              ? new Date().toISOString()
              : null,
            conversation_url: page?.url() || null,
            ...(e.partial?.answer ? { answer: e.partial.answer } : {}),
            ...(e.partial?.mode ? { mode: e.partial.mode } : {}),
          });
          if (
            ["waiting_login", "waiting_verification", "uncertain"].includes(
              status,
            )
          ) {
            this.blocked.add(task.platform);
            this.notify(
              "attention",
              `${platformNames[task.platform]}：${e.message}`,
            );
          }
        }
        this.finishBatch(task.batch_id);
        this.current = null;
        if (!this.store.getSetting("paused"))
          await new Promise((r) => setTimeout(r, 3000));
      }
    } finally {
      this.current = null;
      this.busy = false;
      this.awake?.kill();
      this.awake = null;
    }
  }
  finishBatch(id: number) {
    const tasks = this.store.tasks({ batchId: id });
    if (
      tasks.every((t) =>
        ["succeeded", "partial", "failed", "cancelled"].includes(t.status),
      )
    ) {
      const b = this.store.db
        .prepare("SELECT finished_at FROM batches WHERE id=?")
        .get(id);
      if (!b?.finished_at) {
        this.store.db
          .prepare("UPDATE batches SET finished_at=? WHERE id=?")
          .run(new Date().toISOString(), id);
        this.notify(
          tasks.every((t) => t.status === "succeeded") ? "complete" : "warning",
          `第 ${id} 轮完成：${tasks.filter((t) => t.status === "succeeded").length}/${tasks.length} 成功，${tasks.filter((t) => t.status === "partial").length} 条来源待核对`,
        );
      }
    }
  }
  pause() {
    this.store.setSetting("paused", true);
    this.controller?.abort();
    this.notify("paused", "监测已暂停；已提交但未确认完成的任务需要核对原会话");
  }
  resume() {
    this.store.setSetting("paused", false);
    void this.tick();
  }
  releasePlatform(platform: string) {
    // Submitted/uncertain tasks require a separate explicit decision, never resubmit here.
    for (const t of this.store.tasks({ platform }))
      if (["waiting_login", "waiting_verification"].includes(t.status))
        this.store.patchTask(t.id, {
          status:
            t.phase === "submitted" ||
            t.phase === "extracting" ||
            t.phase === "submitting"
              ? "uncertain"
              : "pending",
          error: null,
        });
    if (!this.store.tasks({ platform, status: "uncertain" }).length)
      this.blocked.delete(platform);
    void this.tick();
  }
  retry(id: number) {
    const t = this.store.task(id);
    if (
      !t ||
      !["failed", "partial", "uncertain", "cancelled"].includes(t.status)
    )
      throw new Error("此任务当前不能重新采集");
    if (this.busy) throw new Error("请先暂停并等待当前任务结束，再重新采集");
    // A retry is a new task in a new batch. Original result remains part of history.
    const batch = this.store.db
      .prepare("INSERT INTO batches(trigger,created_at) VALUES (?,?)")
      .run("retry", new Date().toISOString());
    this.store.db
      .prepare(
        "INSERT INTO tasks(batch_id,question_id,question_text,question_version,group_name,platform) VALUES (?,?,?,?,?,?)",
      )
      .run(
        Number(batch.lastInsertRowid),
        t.question_id,
        t.question_text,
        t.question_version,
        t.group_name,
        t.platform,
      );
    if (t.status === "uncertain")
      this.store.patchTask(id, {
        status: "failed",
        error: (t.error || "") + "；用户确认另开新对话重采",
        finished_at: new Date().toISOString(),
      });
    this.finishBatch(t.batch_id);
    if (!this.store.tasks({ platform: t.platform, status: "uncertain" }).length)
      this.blocked.delete(t.platform);
    return Number(batch.lastInsertRowid);
  }
  async diagnostic(
    task: Task,
    page: Awaited<ReturnType<BrowserPool["page"]>> | undefined,
    error: Error,
  ) {
    const name = `${task.id}-${Date.now()}`;
    const base = join(dataDir, "diagnostics", name);
    if (page)
      await page
        .screenshot({ path: base + ".png", fullPage: false, timeout: 5000 })
        .catch(() => {});
    writeFileSync(
      base + ".json",
      JSON.stringify(
        {
          taskId: task.id,
          platform: task.platform,
          error: error.message,
          url: page?.url(),
          phase: this.store.task(task.id)?.phase,
          time: new Date().toISOString(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    return name;
  }
  cleanup() {
    const dir = join(dataDir, "diagnostics");
    const cutoff = Date.now() - 30 * 86400000;
    for (const file of readdirSync(dir)) {
      const path = join(dir, file);
      if (statSync(path).isFile() && statSync(path).mtimeMs < cutoff)
        unlinkSync(path);
    }
  }
  async stop() {
    this.stopping = true;
    if (this.interval) clearInterval(this.interval);
    this.controller?.abort();
    await this.browsers.close();
    while (this.busy) await new Promise((r) => setTimeout(r, 100));
  }
}
