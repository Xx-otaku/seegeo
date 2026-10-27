import { spawn, execFile, type ChildProcess } from "node:child_process";
import { readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { Store } from "./store.js";
import { BrowserPool, platformUrls } from "./browser.js";
import { collect, recoverExisting } from "./collector.js";
import {
  CollectorError,
  platformIds,
  platformNames,
  type Task,
  type Platform,
} from "./types.js";
import { latestSlot } from "./schedule.js";
import { defaultRetryPolicy, type RetryPolicy } from "./retry-policy.js";
import { dataDir } from "./config.js";

const terminal = (t: Task) =>
  ["succeeded", "partial", "failed", "skipped", "cancelled"].includes(t.status);
const submitted = (t: Task) =>
  ["submitting", "submitted", "extracting"].includes(t.phase);
type Dependencies = {
  collect?: typeof collect;
  recover?: typeof recoverExisting;
  delayMs?: number;
  diagnostics?: boolean;
  pauseGraceMs?: number;
  budgetMs?: number;
  attemptMs?: number;
  recoveryMs?: number;
};

/** A single worker owns all browser writes. Control commands serialize; abort fences late results. */
export class Runner {
  busy = false;
  current: number | null = null;
  private controller: AbortController | null = null;
  private page: Page | undefined;
  private worker: Promise<void> | null = null;
  private operation: Promise<boolean> | null = null;
  private commands: Promise<unknown> = Promise.resolve();
  private awake: ChildProcess | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  constructor(
    public store: Store,
    public browsers = new BrowserPool(),
    private deps: Dependencies = {},
  ) {}
  private serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.commands.then(fn);
    this.commands = next.catch(() => {});
    return next;
  }
  start() {
    this.store.recover();
    this.cleanup();
    this.interval = setInterval(
      () => void this.tick().catch((e) => this.store.event("error", String(e))),
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
    if (!this.store.getSetting("paused")) this.expireWaiting();
    if (this.stopping || this.busy || this.store.getSetting("paused")) return;
    const schedule = this.store.schedule;
    if (
      schedule.enabled &&
      this.store.validatedPlatforms().length === platformIds.length &&
      this.store.questions().some((q) => q.enabled)
    ) {
      const slot = latestSlot(schedule, now);
      if (!schedule.lastSlot || slot > schedule.lastSlot)
        this.store.transaction(() => {
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
    await this.work();
  }
  get retryPolicy() {
    return (
      this.store.getSetting<RetryPolicy>("retryPolicy") || defaultRetryPolicy
    );
  }
  private expireWaiting() {
    for (const t of this.store.tasks())
      if (
        ["waiting_login", "waiting_verification", "uncertain"].includes(
          t.status,
        ) &&
        t.retry_deadline_at &&
        Date.parse(t.retry_deadline_at) <= Date.now()
      ) {
        this.store.patchTask(t.id, {
          status: "skipped",
          finished_at: new Date().toISOString(),
          error: `等待恢复超过时限，已跳过；${t.error || ""}`,
          interruption_reason: "retry_timeout",
        });
        this.store.event(
          "skipped",
          `任务 ${t.id} 超时跳过，不再屏蔽 ${platformNames[t.platform]}`,
        );
        this.finishBatch(t.batch_id);
        const b = this.store.batch(t.batch_id);
        if (b && !b.finished_at && b.control_state === "waiting")
          this.store.setBatchState(t.batch_id, "running");
      }
  }
  private async closeBounded(page: Page | undefined) {
    if (!page) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.browsers.interrupt(page),
        new Promise<void>((r) => {
          timer = setTimeout(r, 5000);
        }),
      ]);
    } catch {
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private blocked() {
    const b = this.store.activeBatch();
    return b
      ? this.store
          .tasks({ batchId: Number(b.id) })
          .filter((t) =>
            ["waiting_login", "waiting_verification", "uncertain"].includes(
              t.status,
            ),
          )
          .map((t) => t.platform)
      : [];
  }
  work(): Promise<void> {
    if (this.worker) return this.worker;
    if (this.stopping || this.busy || this.store.getSetting("paused"))
      return Promise.resolve();
    this.busy = true;
    this.worker = this.run()
      .catch((e) => {
        this.store.event("error", String(e));
        const b = this.store.activeBatch();
        if (b) this.store.setBatchState(Number(b.id), "paused", this.current);
        this.store.setSetting("paused", true);
      })
      .finally(() => {
        this.current = null;
        this.page = undefined;
        this.controller = null;
        this.busy = false;
        this.worker = null;
        this.awake?.kill();
        this.awake = null;
      });
    return this.worker;
  }
  private async interrupt(reason: string) {
    const page = this.page,
      operation = this.operation;
    this.controller?.abort(reason);
    let settled = false;
    if (reason === "manual_pause" && operation) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        settled = await Promise.race([
          operation,
          new Promise<boolean>((r) => {
            timer = setTimeout(() => r(false), this.deps.pauseGraceMs ?? 3000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    // A cooperative pause keeps the live conversation (and its generation stream).
    // Cancel or an unresponsive collector closes only its tab, fencing all browser writes.
    if (page && !settled) await this.closeBounded(page);
    await this.worker;
  }
  private async guarded<T>(
    operation: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    this.operation = operation.then(
      () => true,
      () => true,
    );
    if (signal.aborted) throw new CollectorError("采集操作已中断", "cancelled");
    let stop: () => void = () => {};
    const abort = new Promise<never>((_, reject) => {
      stop = () => reject(new CollectorError("采集操作已中断", "cancelled"));
      signal.addEventListener("abort", stop, { once: true });
    });
    try {
      return await Promise.race([operation, abort]);
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }
  private async run() {
    if (process.platform === "darwin") {
      this.awake = spawn("/usr/bin/caffeinate", ["-d", "-i", "-s"]);
      this.awake.on("error", () => {});
    }
    while (!this.stopping && !this.store.getSetting("paused")) {
      const task = this.store.nextPending(this.blocked());
      if (!task) {
        const b = this.store.activeBatch();
        if (b && this.blocked().length)
          this.store.setBatchState(Number(b.id), "waiting");
        break;
      }
      this.current = task.id;
      const controller = new AbortController();
      this.controller = controller;
      const signal = controller.signal;
      const deadline = task.retry_deadline_at
        ? Date.parse(task.retry_deadline_at)
        : Date.now() +
          (this.deps.budgetMs ?? this.retryPolicy.totalSeconds * 1000);
      this.store.patchTask(task.id, {
        retry_deadline_at: new Date(deadline).toISOString(),
      });
      const expire = () => {
        if (Date.now() >= deadline && !signal.aborted)
          controller.abort("task_timeout");
      };
      const watchdog = setInterval(
        expire,
        Math.min(1000, this.deps.budgetMs ?? 1000),
      );
      const deadlineTimer = setTimeout(
        expire,
        Math.max(0, deadline - Date.now()),
      );

      let attempt = this.store.beginAttempt(
        task.id,
        submitted(task) ? "recover" : "collect",
      );
      this.store.patchTask(task.id, {
        status: "running",
        attempts: task.attempts + 1,
        started_at: task.started_at || new Date().toISOString(),
        error: null,
      });
      const onPhase: Parameters<typeof collect>[3] = (phase, details) => {
        if (!signal.aborted)
          this.store.patchTask(task.id, {
            phase,
            conversation_url: this.page?.url() || null,
            ...details,
          });
      };
      try {
        const page = await this.guarded(
          this.browsers.page(task.platform),
          signal,
        );
        if (signal.aborted)
          throw new CollectorError("采集操作已中断", "cancelled");
        this.page = page;
        let result;
        if (submitted(task)) {
          try {
            if (!task.conversation_url || !task.mode)
              throw new CollectorError("原会话信息不足", "uncertain", true);
            this.assertUrl(task.platform, task.conversation_url);
            if (page.url() !== task.conversation_url)
              await this.guarded(
                page.goto(task.conversation_url, {
                  waitUntil: "domcontentloaded",
                  timeout: 30000,
                }),
                signal,
              );
            result = await this.guarded(
              (this.deps.recover || recoverExisting)(
                page,
                task.platform,
                task.question_text,
                task.mode,
                task.model,
                task.started_at || undefined,
                signal,
                Math.max(
                  1,
                  Math.min(
                    this.deps.recoveryMs ?? 60000,
                    deadline - Date.now(),
                  ),
                ),
              ),
              signal,
            );
          } catch (e) {
            if (
              signal.aborted ||
              (e instanceof CollectorError &&
                ["login", "verification", "mode", "cancelled"].includes(e.kind))
            )
              throw e;
            this.store.endAttempt(
              attempt,
              "recovery_unavailable",
              this.store.task(task.id)!,
              String(e),
            );
            this.store.event(
              "retry",
              `任务 ${task.id} 原会话无法继续，另开新对话重试一次`,
            );
            attempt = this.store.beginAttempt(task.id, "fallback");
            this.store.patchTask(task.id, {
              phase: "queued",
              conversation_url: null,
              attempts: task.attempts + 2,
            });
          }
        }
        if (!result)
          result = await this.guarded(
            (this.deps.collect || collect)(
              page,
              task.platform,
              task.question_text,
              onPhase,
              signal,
              {
                allowAutoSearch:
                  this.store.getSetting("allowAutoSearch") === true,
                timeoutMs: Math.max(
                  1,
                  Math.min(
                    this.deps.attemptMs ??
                      this.retryPolicy.attemptSeconds * 1000,
                    deadline - Date.now(),
                  ),
                ),
              },
            ),
            signal,
          );
        if (!signal.aborted) {
          this.store.completeTask(task.id, result);
          this.store.patchTask(task.id, { interruption_reason: null });
          this.store.endAttempt(
            attempt,
            "completed",
            this.store.task(task.id)!,
          );
        }
      } catch (error) {
        const e =
          error instanceof CollectorError
            ? error
            : new CollectorError(String(error), "uncertain", true);
        const fresh = this.store.task(task.id)!;
        if (signal.aborted) {
          if (signal.reason === "task_timeout") {
            await this.closeBounded(this.page);
            this.store.patchTask(task.id, {
              status: "skipped",
              finished_at: new Date().toISOString(),
              interruption_reason: "retry_timeout",
              error: `每项总时限 ${this.retryPolicy.totalSeconds} 秒已到，已跳过；原会话可能仍有回答`,
            });
            this.store.event(
              "skipped",
              `任务 ${task.id} 到达总时限，继续下一项`,
            );
          } else
            this.store.patchTask(task.id, {
              status: signal.reason === "user_cancel" ? "cancelled" : "paused",
              interruption_reason: String(signal.reason || "unexpected_exit"),
              interrupted_at: new Date().toISOString(),
              retry_deadline_at: null,
              automatic_retries: 0,
              error:
                signal.reason === "user_cancel"
                  ? "用户取消本轮；已完成结果保留"
                  : "已暂停，继续时优先恢复此项",
            });
        } else {
          const diagnostic =
            this.deps.diagnostics === false
              ? null
              : await this.diagnostic(fresh, this.page, e);
          if (signal.aborted) {
            this.store.patchTask(task.id, {
              status:
                signal.reason === "task_timeout"
                  ? "skipped"
                  : signal.reason === "user_cancel"
                    ? "cancelled"
                    : "paused",
              finished_at:
                signal.reason === "task_timeout"
                  ? new Date().toISOString()
                  : null,
              interruption_reason: String(signal.reason),
              error: "操作已中断",
            });
          } else if (e.kind === "login" || e.kind === "verification") {
            this.store.patchTask(task.id, {
              status:
                e.kind === "login" ? "waiting_login" : "waiting_verification",
              error: e.message,
              diagnostic,
              retry_deadline_at: new Date(
                Math.min(deadline, Date.now() + 60000),
              ).toISOString(),
            });
            this.notify(
              "attention",
              `${platformNames[task.platform]}：${e.message}；60 秒内未处理将跳过此项`,
            );
          } else if (
            e.kind !== "mode" &&
            (fresh.automatic_retries || 0) <
              this.retryPolicy.automaticRetries &&
            Date.now() < deadline
          ) {
            this.store.patchTask(task.id, {
              status: "paused",
              automatic_retries: (fresh.automatic_retries || 0) + 1,
              interruption_reason: "auto_recovery",
              diagnostic,
              error: e.message,
              ...(e.partial?.answer ? { answer: e.partial.answer } : {}),
              ...(e.partial?.mode ? { mode: e.partial.mode } : {}),
              ...(e.partial?.conversationUrl
                ? { conversation_url: e.partial.conversationUrl }
                : {}),
            });
            this.store.setBatchState(task.batch_id, "running", task.id);
            this.store.event(
              "auto_recovery",
              `任务 ${task.id} 自动恢复 ${(fresh.automatic_retries || 0) + 1}/${this.retryPolicy.automaticRetries}，先核对原会话；${e.message}`,
            );
          } else {
            this.store.patchTask(task.id, {
              status: "skipped",
              finished_at: new Date().toISOString(),
              interruption_reason:
                e.kind === "mode" ? "mode_unconfirmed" : "retries_exhausted",
              error: `恢复次数已用完或无法安全继续，已跳过；${e.message}`,
              diagnostic,
              ...(e.partial?.answer ? { answer: e.partial.answer } : {}),
              ...(e.partial?.mode ? { mode: e.partial.mode } : {}),
            });
            this.notify(
              "skipped",
              `${platformNames[task.platform]} 任务 ${task.id} 已跳过，队列继续`,
            );
          }
        }
        this.store.endAttempt(
          attempt,
          this.store.task(task.id)!.status,
          this.store.task(task.id)!,
          e.message,
        );
      }
      clearInterval(watchdog);
      clearTimeout(deadlineTimer);
      this.finishBatch(task.batch_id);
      this.current = null;
      this.page = undefined;
      if (!this.store.getSetting("paused") && !signal.aborted)
        await this.guarded(
          new Promise((r) => setTimeout(r, this.deps.delayMs ?? 3000)),
          signal,
        ).catch(() => {});
    }
  }
  finishBatch(id: number) {
    const tasks = this.store.tasks({ batchId: id });
    const b = this.store.batch(id);
    if (
      b &&
      !b.finished_at &&
      b.control_state !== "cancelling" &&
      tasks.length &&
      tasks.every(terminal)
    ) {
      this.store.db
        .prepare(
          "UPDATE batches SET finished_at=?,control_state='completed',resume_task_id=NULL WHERE id=?",
        )
        .run(new Date().toISOString(), id);
      this.notify(
        tasks.every((t) => t.status === "succeeded") ? "complete" : "warning",
        `第 ${id} 轮完成：${tasks.filter((t) => t.status === "succeeded").length}/${tasks.length} 成功，${tasks.filter((t) => t.status === "skipped").length} 项跳过`,
      );
    }
  }
  pause() {
    return this.serial(async () => {
      const b = this.store.activeBatch();
      if (b?.control_state === "paused") return;
      this.store.setSetting("paused", true);
      if (b) this.store.setBatchState(Number(b.id), "pausing", this.current);
      await this.interrupt("manual_pause");
      if (b && !this.store.batch(Number(b.id))?.finished_at)
        this.store.setBatchState(Number(b.id), "paused");
      this.notify("paused", "监测已暂停，继续时优先恢复未完成的问题");
    });
  }
  resume() {
    return this.serial(() => {
      const b = this.store.activeBatch();
      if (b) {
        for (const t of this.store.tasks({ batchId: Number(b.id) }))
          if (
            ["uncertain", "waiting_login", "waiting_verification"].includes(
              t.status,
            )
          )
            this.store.patchTask(t.id, {
              status: submitted(t) ? "paused" : "pending",
              retry_deadline_at: null,
              automatic_retries: 0,
            });
        for (const t of this.store.tasks({ batchId: Number(b.id) }))
          if (t.status === "paused")
            this.store.patchTask(t.id, {
              retry_deadline_at: null,
              automatic_retries: 0,
            });
        this.store.setBatchState(Number(b.id), "running");
      }
      this.store.setSetting("paused", false);
      void this.work();
    });
  }
  cancel(id: number) {
    return this.serial(async () => {
      const b = this.store.batch(id);
      if (!b) throw new Error("批次不存在");
      if (b.finished_at) return;
      this.store.setBatchState(id, "cancelling");
      this.store.setSetting("paused", true);
      if (this.worker) await this.interrupt("user_cancel");
      this.store.transaction(() => {
        for (const t of this.store.tasks({ batchId: id }))
          if (!terminal(t) || (t.status === "cancelled" && !t.finished_at))
            this.store.patchTask(t.id, {
              status: "cancelled",
              finished_at: new Date().toISOString(),
              interruption_reason: "user_cancel",
              error: "用户取消本轮；已完成结果保留",
            });
        this.store.db
          .prepare(
            "UPDATE batches SET control_state='cancelled',finished_at=?,resume_task_id=NULL WHERE id=?",
          )
          .run(new Date().toISOString(), id);
        const schedule = this.store.schedule;
        const slot = latestSlot(schedule, new Date());
        if (!schedule.lastSlot || schedule.lastSlot < slot)
          this.store.setSetting("schedule", { ...schedule, lastSlot: slot });
        this.store.setSetting("paused", false);
      });
      this.notify("cancelled", `第 ${id} 轮已取消，已完成的回答和来源已保留`);
    });
  }
  create(platforms: Platform[], questionIds?: number[]) {
    return this.serial(() => {
      this.assertIdle();
      const id = this.store.createBatch("manual", platforms, questionIds);
      this.store.setSetting("paused", false);
      void this.work();
      return id;
    });
  }
  rerun(id: number) {
    return this.serial(() => {
      this.assertIdle();
      const next = this.store.cloneBatch(id);
      this.store.setSetting("paused", false);
      void this.work();
      return next;
    });
  }
  retry(id: number) {
    return this.serial(() => {
      const t = this.store.task(id);
      if (
        !t ||
        !["failed", "partial", "uncertain", "skipped", "cancelled"].includes(
          t.status,
        )
      )
        throw new Error("此任务当前不能重新采集");
      this.assertIdle();
      const next = this.store.cloneBatch(t.batch_id, id);
      this.store.setSetting("paused", false);
      void this.work();
      return next;
    });
  }
  releasePlatform(platform: string) {
    return this.serial(() => {
      const b = this.store.activeBatch();
      if (!b) return;
      for (const t of this.store.tasks({ batchId: Number(b.id), platform }))
        if (
          ["waiting_login", "waiting_verification", "uncertain"].includes(
            t.status,
          )
        )
          this.store.patchTask(t.id, {
            status: submitted(t) ? "paused" : "pending",
            error: null,
          });
      if (!this.store.getSetting("paused")) {
        this.store.setBatchState(Number(b.id), "running");
        void this.work();
      }
    });
  }
  private assertIdle() {
    if (this.busy || this.store.hasUnfinished())
      throw new Error("请先完成或取消当前批次，再开始新一轮");
  }
  assertUrl(platform: Platform, url: string) {
    if (new URL(url).origin !== new URL(platformUrls[platform]).origin)
      throw new Error("原会话地址不属于该平台");
  }
  openConversation(id: number) {
    return this.serial(async () => {
      const t = this.store.task(id);
      if (!t?.conversation_url) throw new Error("没有可打开的原会话");
      this.assertUrl(t.platform, t.conversation_url);
      await this.browsers.open(t.platform, t.conversation_url);
    });
  }
  login(platform: Platform) {
    return this.serial(async () => {
      if (this.busy) throw new Error("请先暂停监测，避免影响采集会话");
      this.busy = true;
      try {
        await this.browsers.login(platform);
      } finally {
        this.busy = false;
      }
    });
  }
  recoverTask(id: number) {
    return this.serial(async () => {
      if (this.busy) throw new Error("请先暂停并等待采集停止");
      const t = this.store.task(id);
      if (
        !t?.conversation_url ||
        !t.mode ||
        ![
          "paused",
          "uncertain",
          "partial",
          "waiting_login",
          "waiting_verification",
        ].includes(t.status)
      )
        throw new Error("缺少可恢复的原会话或模式");
      this.assertUrl(t.platform, t.conversation_url);
      this.busy = true;
      const attempt = this.store.beginAttempt(t.id, "manual_recover");
      try {
        const page = await this.browsers.page(t.platform);
        await page.goto(t.conversation_url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        const result = await (this.deps.recover || recoverExisting)(
          page,
          t.platform,
          t.question_text,
          t.mode,
          t.model,
          t.started_at || undefined,
          undefined,
          30000,
        );
        this.store.completeTask(id, result);
        this.store.endAttempt(attempt, "completed", this.store.task(id)!);
        this.finishBatch(t.batch_id);
      } catch (e) {
        this.store.endAttempt(
          attempt,
          "failed",
          this.store.task(id)!,
          String(e),
        );
        throw e;
      } finally {
        this.busy = false;
      }
    });
  }
  controls() {
    const b = this.store.activeBatch();
    const latest = b || this.store.batches()[0] || null;
    const transitional =
      !!b && ["pausing", "cancelling"].includes(String(b.control_state));
    const operation = (enabled: boolean, reason: string) => ({
      enabled,
      reason: enabled ? null : reason,
    });
    const pausedTask = b
      ? this.store
          .tasks({ batchId: Number(b.id) })
          .find((t) => t.id === b.resume_task_id) ||
        this.store.tasks({ batchId: Number(b.id), status: "paused" })[0] ||
        null
      : null;
    return {
      activeBatch: b || null,
      displayBatch: latest,
      pausedTask: pausedTask
        ? {
            id: pausedTask.id,
            platform: pausedTask.platform,
            question_text: pausedTask.question_text,
            phase: pausedTask.phase,
          }
        : null,
      currentItem: this.current ? this.store.task(this.current) : null,
      controls: {
        start: operation(!this.busy && !b, "请先完成或取消当前批次"),
        pause: operation(
          !!b && !transitional && b.control_state !== "paused",
          "当前没有可暂停的监测",
        ),
        resume: operation(
          !!b &&
            !transitional &&
            ["paused", "waiting"].includes(String(b.control_state)),
          "当前没有可继续的监测",
        ),
        cancel: operation(!!b && !transitional, "当前没有可取消的监测"),
        rerun: operation(
          !this.busy && !b && !!latest,
          "请先完成或取消当前批次",
        ),
      },
    };
  }
  async diagnostic(task: Task, page: Page | undefined, error: Error) {
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
    for (const file of readdirSync(dir)) {
      const p = join(dir, file);
      if (
        statSync(p).isFile() &&
        statSync(p).mtimeMs < Date.now() - 30 * 86400000
      )
        unlinkSync(p);
    }
  }
  async stop() {
    this.stopping = true;
    if (this.interval) clearInterval(this.interval);
    await this.serial(async () => {
      const b = this.store.activeBatch();
      if (b) this.store.setSetting("paused", true);
      if (b) this.store.setBatchState(Number(b.id), "paused", this.current);
      await this.interrupt("service_stop");
      await this.browsers.close();
    });
  }
}
