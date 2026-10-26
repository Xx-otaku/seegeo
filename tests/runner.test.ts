import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { Runner } from "../server/runner.js";
import { BrowserPool } from "../server/browser.js";
import { CollectorError, type Capture } from "../server/types.js";
import type { collect, recoverExisting } from "../server/collector.js";

const capture = (question = "测试问题"): Capture => ({
  answer: question + "的回答",
  html: "<p>回答</p>",
  sources: [],
  sourceStatus: "none",
  model: null,
  mode: { search: "auto", thinking: false, searchTriggered: false },
  conversationUrl: "https://www.doubao.com/chat/test",
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
});
const defer = <T = void>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const until = async (f: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (f()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("状态转换超时");
};
function setup(
  collectFn: typeof collect,
  recoverFn?: typeof recoverExisting,
  count = 2,
) {
  const store = new Store(":memory:");
  store.setSetting("notifications", false);
  store.setSetting("schedule", { ...store.schedule, enabled: false });
  store.importQuestions(
    Array.from({ length: count }, (_, i) => ({ text: `问题${i}` })),
  );
  const batch = store.createBatch("manual", ["doubao"]);
  const page = {
    url: () => "https://www.doubao.com/chat/test",
    goto: async () => null,
  };
  const pool = {
    page: async () => page,
    interrupt: async () => {},
    close: async () => {},
  } as unknown as BrowserPool;
  const runner = new Runner(store, pool, {
    collect: collectFn,
    recover: recoverFn,
    delayMs: 0,
    diagnostics: false,
    pauseGraceMs: 0,
  });
  return { store, runner, batch };
}
for (const phase of ["opening", "submitted", "extracting"])
  test(`暂停于 ${phase} 后优先恢复当前项，成功项不重采`, async () => {
    const entered = defer();
    const late = defer<Capture>();
    const calls: string[] = [];
    let recoveries = 0;
    const { store, runner, batch } = setup(
      async (_p, _platform, q, onPhase) => {
        calls.push(q);
        onPhase(phase, { mode: capture().mode, model: null });
        if (calls.length === 1) {
          entered.resolve();
          return late.promise;
        }
        return capture(q);
      },
      async () => {
        recoveries++;
        return capture("恢复");
      },
    );
    const worker = runner.work();
    await entered.promise;
    const first = runner.current!;
    await runner.pause();
    assert.equal(store.task(first)?.status, "paused");
    assert.equal(store.batch(batch)?.control_state, "paused");
    assert.equal(runner.busy, false);
    await Promise.all([runner.resume(), runner.resume(), runner.resume()]);
    await until(() => !runner.busy);
    assert.equal(store.task(first)?.status, "succeeded");
    assert.ok(store.tasks().every((t) => t.status === "succeeded"));
    assert.equal(recoveries, phase === "opening" ? 0 : 1);
    assert.equal(calls.length, phase === "opening" ? 3 : 2);
    late.resolve(capture("迟到旧结果"));
    await worker;
    await new Promise((r) => setTimeout(r, 5));
    assert.notEqual(store.task(first)?.answer, "迟到旧结果的回答");
    assert.ok(store.attempts(first).some((a) => a.outcome === "paused"));
    await runner.stop();
    store.close();
  });
test("运行中取消会中断采集，拒收迟到结果，立即允许整轮重跑且快照范围一致", async () => {
  const entered = defer();
  const late = defer<Capture>();
  let calls = 0;
  const { store, runner, batch } = setup(async (_p, _platform, q, onPhase) => {
    calls++;
    onPhase("submitted", { mode: capture().mode, model: null });
    if (calls === 1) {
      entered.resolve();
      return late.promise;
    }
    return capture(q);
  });
  void runner.work();
  await entered.promise;
  const old = runner.current!;
  await runner.cancel(batch);
  assert.equal(runner.busy, false);
  assert.equal(store.batch(batch)?.control_state, "cancelled");
  assert.equal(store.hasUnfinished(), false);
  const oldSnapshot = store
    .tasks({ batchId: batch })
    .map((t) => [t.question_text, t.question_version, t.platform]);
  for (const q of store.questions()) {
    store.updateQuestion(q.id, { text: "已修改" + q.id, enabled: false });
    store.deleteQuestion(q.id);
  }
  const next = await runner.rerun(batch);
  await until(() => !runner.busy);
  assert.deepEqual(
    store
      .tasks({ batchId: next })
      .map((t) => [t.question_text, t.question_version, t.platform]),
    oldSnapshot,
  );
  assert.ok(
    store.tasks({ batchId: next }).every((t) => t.status === "succeeded"),
  );
  late.resolve(capture("迟到"));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(store.task(old)?.status, "cancelled");
  await runner.stop();
  store.close();
});
test("暂停后取消保留已完成回答和来源，重复取消幂等", async () => {
  const entered = defer();
  let calls = 0;
  const { store, runner, batch } = setup(async (_p, _platform, q) => {
    if (++calls === 2) {
      entered.resolve();
      await new Promise(() => {});
    }
    return {
      ...capture(q),
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
      sourceStatus: "extracted",
    };
  });
  void runner.work();
  await entered.promise;
  const complete = store.tasks({ status: "succeeded" })[0];
  await runner.pause();
  await Promise.all([runner.cancel(batch), runner.cancel(batch)]);
  assert.equal(store.task(complete.id)?.sources.length, 1);
  assert.equal(store.task(complete.id)?.status, "succeeded");
  assert.equal(store.hasUnfinished(), false);
  await runner.stop();
  store.close();
});
test("原会话失效只新建重试一次；验证码不自动重新提问", async () => {
  for (const kind of ["uncertain", "verification"] as const) {
    let collects = 0;
    const { store, runner, batch } = setup(
      async () => {
        collects++;
        return capture();
      },
      async () => {
        throw new CollectorError("原会话问题", kind, true);
      },
      1,
    );
    const t = store.tasks()[0];
    store.patchTask(t.id, {
      status: "paused",
      phase: "submitted",
      mode: capture().mode,
      conversation_url: capture().conversationUrl,
    });
    store.setBatchState(batch, "paused", t.id);
    store.setSetting("paused", true);
    await runner.resume();
    await until(() => !runner.busy);
    assert.equal(collects, kind === "uncertain" ? 1 : 0);
    assert.equal(
      store.task(t.id)?.status,
      kind === "uncertain" ? "succeeded" : "waiting_verification",
    );
    if (kind === "uncertain")
      assert.deepEqual(
        store.attempts(t.id).map((a) => a.kind),
        ["recover", "fallback"],
      );
    await runner.stop();
    store.close();
  }
});
test("快速暂停继续取消命令不会产生两个 worker 或跳过当前项", async () => {
  const entered = defer();
  let concurrent = 0,
    max = 0,
    calls = 0;
  const { store, runner, batch } = setup(async () => {
    concurrent++;
    max = Math.max(max, concurrent);
    if (++calls === 1) {
      entered.resolve();
      await new Promise((r) => setTimeout(r, 40));
    }
    concurrent--;
    return capture();
  });
  void runner.work();
  await entered.promise;
  await Promise.all([runner.pause(), runner.resume(), runner.cancel(batch)]);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(store.hasUnfinished(), false);
  assert.equal(runner.busy, false);
  // The uncooperative old promise is fenced; only its original task may still be unwinding.
  assert.ok(max <= 2);
  assert.equal(store.tasks().filter((t) => t.status === "running").length, 0);
  await runner.stop();
  store.close();
});
test("取消定时轮次后不立即补跑，未来计划仍启用", async () => {
  const { store, runner, batch } = setup(async () => capture(), undefined, 1);
  for (const p of ["doubao", "deepseek", "yuanbao"] as const)
    store.validatePlatform(p);
  store.setSetting("schedule", {
    ...store.schedule,
    enabled: true,
    lastSlot: null,
  });
  await runner.cancel(batch);
  const cursor = store.schedule.lastSlot;
  await runner.tick(new Date());
  assert.equal(store.batches().length, 1);
  assert.ok(store.schedule.enabled);
  assert.ok(cursor);
  await runner.stop();
  store.close();
});
test("单条重采创建新批次并立即执行，原结果保留", async () => {
  const { store, runner, batch } = setup(async () => capture(), undefined, 1);
  await runner.work();
  const t = store.tasks()[0];
  store.patchTask(t.id, { status: "partial", source_status: "failed" });
  const next = await runner.retry(t.id);
  await until(() => !runner.busy);
  assert.notEqual(next, batch);
  assert.equal(store.task(t.id)?.status, "partial");
  assert.equal(store.tasks({ batchId: next })[0].status, "succeeded");
  await runner.stop();
  store.close();
});
test("人工验证解除后继续优先恢复原会话，手动暂停不会屏蔽平台", async () => {
  let recoveries = 0;
  const { store, runner, batch } = setup(
    async () => capture(),
    async () => {
      recoveries++;
      return capture();
    },
    1,
  );
  const t = store.tasks()[0];
  store.patchTask(t.id, {
    status: "waiting_verification",
    phase: "submitted",
    mode: capture().mode,
    conversation_url: capture().conversationUrl,
  });
  store.setBatchState(batch, "waiting");
  await runner.resume();
  await until(() => !runner.busy);
  assert.equal(recoveries, 1);
  assert.equal(store.task(t.id)?.status, "succeeded");
  await runner.stop();
  store.close();
});
test("取消所有剩余项目都具有终止时间，已结束任务不被覆盖", async () => {
  const entered = defer();
  const { store, runner, batch } = setup(async () => {
    entered.resolve();
    return new Promise(() => {});
  });
  void runner.work();
  await entered.promise;
  await runner.cancel(batch);
  assert.ok(
    store.tasks().every((t) => t.status === "cancelled" && t.finished_at),
  );
  await runner.stop();
  store.close();
});
test("合作的采集器暂停时保留浏览器页，恢复优先原会话", async () => {
  const entered = defer();
  let closes = 0;
  let recovered = 0;
  const { store, runner } = setup(
    async (_page, _platform, _q, phase, signal) => {
      phase("submitted", { mode: capture().mode, model: null });
      entered.resolve();
      return new Promise((_r, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new CollectorError("paused", "cancelled", true)),
          { once: true },
        ),
      );
    },
    async () => {
      recovered++;
      return capture();
    },
    1,
  );
  runner.browsers.interrupt = async () => {
    closes++;
  };
  void runner.work();
  await entered.promise;
  await runner.pause();
  assert.equal(closes, 0);
  await runner.resume();
  await until(() => !runner.busy);
  assert.equal(recovered, 1);
  await runner.stop();
  store.close();
});
