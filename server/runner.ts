import { spawn, execFile, type ChildProcess } from "node:child_process";
import { readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { Store } from "./store.js";
import { BrowserPool, platformUrls } from "./browser.js";
import { collect, recoverExisting } from "./collector.js";
import { CollectorError, platformIds, platformNames, type Task, type Platform } from "./types.js";
import { latestSlot } from "./schedule.js";
import { dataDir } from "./config.js";

const terminal = (t: Task) => ["succeeded", "partial", "failed", "cancelled"].includes(t.status);
const submitted = (t: Task) => ["submitting", "submitted", "extracting"].includes(t.phase);
type Dependencies = { collect?: typeof collect; recover?: typeof recoverExisting; delayMs?: number; diagnostics?: boolean };

/** A single worker owns all browser writes. Control commands serialize; abort fences late results. */
export class Runner {
  busy = false;
  current: number | null = null;
  private controller: AbortController | null = null;
  private page: Page | undefined;
  private worker: Promise<void> | null = null;
  private commands: Promise<unknown> = Promise.resolve();
  private awake: ChildProcess | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  constructor(public store: Store, public browsers = new BrowserPool(), private deps: Dependencies = {}) {}
  private serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.commands.then(fn);
    this.commands = next.catch(() => {});
    return next;
  }
  start() {
    this.store.recover(); this.cleanup();
    this.interval = setInterval(() => void this.tick().catch(e => this.store.event("error", String(e))), 15000);
    void this.tick();
  }
  notify(type: string, message: string) {
    this.store.event(type, message);
    if (process.platform === "darwin" && this.store.getSetting("notifications") !== false)
      execFile("/usr/bin/osascript", ["-e", `display notification ${JSON.stringify(message)} with title "seegeo"`], () => {});
  }
  async tick(now = new Date()) {
    if (this.stopping || this.busy || this.store.getSetting("paused")) return;
    const schedule = this.store.schedule;
    if (schedule.enabled && this.store.validatedPlatforms().length === platformIds.length && this.store.questions().some(q => q.enabled)) {
      const slot = latestSlot(schedule, now);
      if (!schedule.lastSlot || slot > schedule.lastSlot) this.store.transaction(() => {
        if (!this.store.hasUnfinished()) this.store.createBatch("schedule", [...platformIds], undefined, slot);
        this.store.setSetting("schedule", { ...schedule, lastSlot: slot });
      });
    }
    await this.work();
  }
  private blocked() {
    const b = this.store.activeBatch();
    return b ? this.store.tasks({batchId:Number(b.id)}).filter(t => ["waiting_login","waiting_verification","uncertain"].includes(t.status)).map(t => t.platform) : [];
  }
  work(): Promise<void> {
    if (this.worker) return this.worker;
    if (this.stopping || this.busy || this.store.getSetting("paused")) return Promise.resolve();
    this.busy = true;
    this.worker = this.run().catch(e => {
      this.store.event("error", String(e));
      const b = this.store.activeBatch();
      if (b) this.store.setBatchState(Number(b.id),"paused",this.current);
      this.store.setSetting("paused",true);
    }).finally(() => {
      this.current=null; this.page=undefined; this.controller=null; this.busy=false; this.worker=null;
      this.awake?.kill(); this.awake=null;
    });
    return this.worker;
  }
  private async interrupt(reason: string) {
    this.controller?.abort(reason);
    // Close only the worker tab, keeping the profile and remote conversation available for recovery.
    if (this.page) await this.browsers.interrupt(this.page).catch(() => {});
    await this.worker;
  }
  private async guarded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new CollectorError("采集操作已中断", "cancelled");
    let stop: () => void = () => {};
    const abort = new Promise<never>((_, reject) => {
      stop = () => reject(new CollectorError("采集操作已中断", "cancelled"));
      signal.addEventListener("abort",stop,{once:true});
    });
    try { return await Promise.race([operation,abort]); }
    finally { signal.removeEventListener("abort",stop); }
  }
  private async run() {
    if (process.platform === "darwin") { this.awake=spawn("/usr/bin/caffeinate",["-i"]); this.awake.on("error",()=>{}); }
    while (!this.stopping && !this.store.getSetting("paused")) {
      const task=this.store.nextPending(this.blocked());
      if (!task) {
        const b=this.store.activeBatch();
        if (b && this.blocked().length) this.store.setBatchState(Number(b.id),"waiting");
        break;
      }
      this.current=task.id;
      const controller=new AbortController(); this.controller=controller;
      const signal=controller.signal;
      let attempt = this.store.beginAttempt(task.id, submitted(task) ? "recover" : "collect");
      this.store.patchTask(task.id,{status:"running",attempts:task.attempts+1,started_at:task.started_at || new Date().toISOString(),error:null});
      const onPhase: Parameters<typeof collect>[3] = (phase, details) => {
        if (!signal.aborted) this.store.patchTask(task.id,{phase,conversation_url:this.page?.url() || null,...details});
      };
      try {
        const page = await this.browsers.page(task.platform);
        if (signal.aborted) throw new CollectorError("采集操作已中断","cancelled");
        this.page=page;
        let result;
        if (submitted(task)) {
          try {
            if (!task.conversation_url || !task.mode) throw new CollectorError("原会话信息不足","uncertain",true);
            this.assertUrl(task.platform,task.conversation_url);
            if (page.url() !== task.conversation_url) await this.guarded(page.goto(task.conversation_url,{waitUntil:"domcontentloaded",timeout:30000}),signal);
            result=await this.guarded((this.deps.recover || recoverExisting)(page,task.platform,task.question_text,task.mode,task.model,task.started_at || undefined,signal),signal);
          } catch(e) {
            if (signal.aborted || (e instanceof CollectorError && ["login","verification","mode","cancelled"].includes(e.kind))) throw e;
            this.store.endAttempt(attempt,"recovery_unavailable",this.store.task(task.id)!,String(e));
            this.store.event("retry",`任务 ${task.id} 原会话无法继续，另开新对话重试一次`);
            attempt=this.store.beginAttempt(task.id,"fallback");
            this.store.patchTask(task.id,{phase:"queued",conversation_url:null,attempts:task.attempts+2});
          }
        }
        if (!result) result=await this.guarded((this.deps.collect || collect)(page,task.platform,task.question_text,onPhase,signal,{allowAutoSearch:this.store.getSetting("allowAutoSearch") === true,timeoutMs:300000}),signal);
        if (!signal.aborted) {
          this.store.completeTask(task.id,result);
          this.store.patchTask(task.id,{interruption_reason:null});
          this.store.endAttempt(attempt,"completed",this.store.task(task.id)!);
        }
      } catch(error) {
        const e=error instanceof CollectorError ? error : new CollectorError(String(error),"uncertain",true);
        const fresh=this.store.task(task.id)!;
        if (signal.aborted) {
          this.store.patchTask(task.id,{status:signal.reason === "user_cancel" ? "cancelled" : "paused",interruption_reason:String(signal.reason || "unexpected_exit"),interrupted_at:new Date().toISOString(),error:signal.reason === "user_cancel" ? "用户取消本轮；已完成结果保留" : "已暂停，继续时优先恢复此项"});
        } else {
          const status:Task["status"] = e.kind === "login" ? "waiting_login" : e.kind === "verification" ? "waiting_verification" : e.submitted ? "uncertain" : e.kind === "network" && task.attempts < 1 ? "pending" : "failed";
          const diagnostic=this.deps.diagnostics === false ? null : await this.diagnostic(fresh,this.page,e);
          // A control command may have arrived while diagnostic capture was in flight.
          if (signal.aborted) this.store.patchTask(task.id,{status:"paused",interruption_reason:String(signal.reason),interrupted_at:new Date().toISOString()});
          else {
            this.store.patchTask(task.id,{status,error:e.message,diagnostic,finished_at:status === "failed" ? new Date().toISOString() : null,...(e.partial?.answer ? {answer:e.partial.answer} : {}),...(e.partial?.mode ? {mode:e.partial.mode} : {})});
            if (["waiting_login","waiting_verification","uncertain"].includes(status)) this.notify("attention",`${platformNames[task.platform]}：${e.message}`);
          }
        }
        this.store.endAttempt(attempt,this.store.task(task.id)!.status,this.store.task(task.id)!,e.message);
      }
      this.finishBatch(task.batch_id);
      this.current=null; this.page=undefined;
      if (!this.store.getSetting("paused") && !signal.aborted) await this.guarded(new Promise(r=>setTimeout(r,this.deps.delayMs ?? 3000)),signal).catch(()=>{});
    }
  }
  finishBatch(id: number) {
    const tasks=this.store.tasks({batchId:id}); const b=this.store.batch(id);
    if (b && !b.finished_at && b.control_state !== "cancelling" && tasks.length && tasks.every(terminal)) {
      this.store.db.prepare("UPDATE batches SET finished_at=?,control_state='completed',resume_task_id=NULL WHERE id=?").run(new Date().toISOString(),id);
      this.notify(tasks.every(t=>t.status === "succeeded") ? "complete" : "warning",`第 ${id} 轮完成：${tasks.filter(t=>t.status === "succeeded").length}/${tasks.length} 成功`);
    }
  }
  pause() { return this.serial(async () => {
    const b=this.store.activeBatch();
    if (b?.control_state === "paused") return;
    this.store.setSetting("paused",true);
    if (b) this.store.setBatchState(Number(b.id),"pausing",this.current);
    await this.interrupt("manual_pause");
    if (b && !this.store.batch(Number(b.id))?.finished_at) this.store.setBatchState(Number(b.id),"paused");
    this.notify("paused","监测已暂停，继续时优先恢复未完成的问题");
  }); }
  resume() { return this.serial(() => {
    const b=this.store.activeBatch();
    if (b) {
      for (const t of this.store.tasks({batchId:Number(b.id)})) if (t.status === "uncertain") this.store.patchTask(t.id,{status:"paused"});
      this.store.setBatchState(Number(b.id),"running");
    }
    this.store.setSetting("paused",false); void this.work();
  }); }
  cancel(id: number) { return this.serial(async () => {
    const b=this.store.batch(id); if (!b) throw new Error("批次不存在");
    if (b.finished_at) return;
    this.store.setBatchState(id,"cancelling"); this.store.setSetting("paused",true);
    if (this.worker) await this.interrupt("user_cancel");
    this.store.transaction(() => {
      for (const t of this.store.tasks({batchId:id})) if (!terminal(t)) this.store.patchTask(t.id,{status:"cancelled",finished_at:new Date().toISOString(),interruption_reason:"user_cancel",error:"用户取消本轮；已完成结果保留"});
      this.store.db.prepare("UPDATE batches SET control_state='cancelled',finished_at=?,resume_task_id=NULL WHERE id=?").run(new Date().toISOString(),id);
      const schedule=this.store.schedule; const slot=latestSlot(schedule,new Date());
      if (!schedule.lastSlot || schedule.lastSlot < slot) this.store.setSetting("schedule",{...schedule,lastSlot:slot});
      this.store.setSetting("paused",false);
    });
    this.notify("cancelled",`第 ${id} 轮已取消，已完成的回答和来源已保留`);
  }); }
  create(platforms: Platform[], questionIds?: number[]) { return this.serial(() => {
    this.assertIdle(); const id=this.store.createBatch("manual",platforms,questionIds);
    this.store.setSetting("paused",false); void this.work(); return id;
  }); }
  rerun(id: number) { return this.serial(() => {
    this.assertIdle(); const next=this.store.cloneBatch(id); this.store.setSetting("paused",false); void this.work(); return next;
  }); }
  retry(id: number) { return this.serial(() => {
    const t=this.store.task(id); if (!t || !["failed","partial","uncertain","cancelled"].includes(t.status)) throw new Error("此任务当前不能重新采集");
    this.assertIdle(); const next=this.store.cloneBatch(t.batch_id,id); this.store.setSetting("paused",false); void this.work(); return next;
  }); }
  releasePlatform(platform: string) { return this.serial(() => {
    const b=this.store.activeBatch(); if (!b) return;
    for (const t of this.store.tasks({batchId:Number(b.id),platform})) if (["waiting_login","waiting_verification","uncertain"].includes(t.status)) this.store.patchTask(t.id,{status:submitted(t) ? "paused" : "pending",error:null});
    if (!this.store.getSetting("paused")) {this.store.setBatchState(Number(b.id),"running");void this.work();}
  }); }
  private assertIdle() { if (this.busy || this.store.hasUnfinished()) throw new Error("请先完成或取消当前批次，再开始新一轮"); }
  assertUrl(platform: Platform, url: string) { if (new URL(url).origin !== new URL(platformUrls[platform]).origin) throw new Error("原会话地址不属于该平台"); }
  openConversation(id: number) { return this.serial(async () => {
    const t=this.store.task(id); if (!t?.conversation_url) throw new Error("没有可打开的原会话");
    this.assertUrl(t.platform,t.conversation_url); await this.browsers.open(t.platform,t.conversation_url);
  }); }
  login(platform: Platform) { return this.serial(async () => {
    if (this.busy) throw new Error("请先暂停监测，避免影响采集会话");
    this.busy=true; try {await this.browsers.login(platform);} finally {this.busy=false;}
  }); }
  recoverTask(id: number) { return this.serial(async () => {
    if (this.busy) throw new Error("请先暂停并等待采集停止");
    const t=this.store.task(id);
    if (!t?.conversation_url || !t.mode || !["paused","uncertain","partial","waiting_login","waiting_verification"].includes(t.status)) throw new Error("缺少可恢复的原会话或模式");
    this.assertUrl(t.platform,t.conversation_url); this.busy=true;
    const attempt=this.store.beginAttempt(t.id,"manual_recover");
    try {
      const page=await this.browsers.page(t.platform); await page.goto(t.conversation_url,{waitUntil:"domcontentloaded",timeout:30000});
      const result=await (this.deps.recover || recoverExisting)(page,t.platform,t.question_text,t.mode,t.model,t.started_at || undefined,undefined,30000);
      this.store.completeTask(id,result); this.store.endAttempt(attempt,"completed",this.store.task(id)!); this.finishBatch(t.batch_id);
    } catch(e) {this.store.endAttempt(attempt,"failed",this.store.task(id)!,String(e));throw e;}
    finally {this.busy=false;}
  }); }
  controls() {
    const b=this.store.activeBatch(); const latest=b || this.store.batches()[0] || null;
    const transitional=!!b && ["pausing","cancelling"].includes(String(b.control_state));
    const operation=(enabled:boolean,reason:string)=>({enabled,reason:enabled ? null : reason});
    const pausedTask=b ? this.store.tasks({batchId:Number(b.id)}).find(t=>t.id === b.resume_task_id) || this.store.tasks({batchId:Number(b.id),status:"paused"})[0] || null : null;
    return {activeBatch:b || null,displayBatch:latest,pausedTask:pausedTask ? {id:pausedTask.id,platform:pausedTask.platform,question_text:pausedTask.question_text,phase:pausedTask.phase} : null,
      currentItem:this.current ? this.store.task(this.current) : null,
      controls:{start:operation(!this.busy&&!b,"请先完成或取消当前批次"),pause:operation(!!b&&!transitional&&b.control_state !== "paused","当前没有可暂停的监测"),resume:operation(!!b&&!transitional&&["paused","waiting"].includes(String(b.control_state)),"当前没有可继续的监测"),cancel:operation(!!b&&!transitional,"当前没有可取消的监测"),rerun:operation(!this.busy&&!b&&!!latest,"请先完成或取消当前批次")}};
  }
  async diagnostic(task: Task, page: Page | undefined,error: Error) {
    const name=`${task.id}-${Date.now()}`;const base=join(dataDir,"diagnostics",name);
    if (page) await page.screenshot({path:base+".png",fullPage:false,timeout:5000}).catch(()=>{});
    writeFileSync(base+".json",JSON.stringify({taskId:task.id,platform:task.platform,error:error.message,url:page?.url(),phase:this.store.task(task.id)?.phase,time:new Date().toISOString()},null,2),{mode:0o600});return name;
  }
  cleanup() { const dir=join(dataDir,"diagnostics");for(const file of readdirSync(dir)){const p=join(dir,file);if(statSync(p).isFile()&&statSync(p).mtimeMs<Date.now()-30*86400000)unlinkSync(p);} }
  async stop() {this.stopping=true;if(this.interval)clearInterval(this.interval);await this.serial(async()=>{const b=this.store.activeBatch();this.store.setSetting("paused",true);if(b)this.store.setBatchState(Number(b.id),"paused",this.current);await this.interrupt("service_stop");await this.browsers.close();});}
}
