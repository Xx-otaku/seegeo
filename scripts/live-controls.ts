/** Opt-in, real account smoke test. Uses an isolated database; never resumes the user's batch. */
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { Store } from "../server/store.js";
import { Runner } from "../server/runner.js";
import { BrowserPool } from "../server/browser.js";
import { collect, selectors } from "../server/collector.js";
import { platformIds } from "../server/types.js";
import { dataDir } from "../server/config.js";
if (!process.argv.includes("--live"))
  throw new Error("真实账号测试须显式添加 --live；不会使用当前业务批次");
const stamp = Date.now();
const store = new Store(join(dataDir, `controls-smoke-${stamp}.sqlite`));
store.setSetting("notifications", false);
store.setSetting("allowAutoSearch", true);
store.setSetting("schedule", { ...store.schedule, enabled: false });
store.importQuestions([
  {
    text: "请联网查询 Python 官方文档中列表与元组的区别，用三句话解释并标注来源。",
    group_name: "控制回归",
  },
  { text: "请简短介绍 SQLite 的主要用途。", group_name: "控制回归" },
]);
const pool = new BrowserPool();
const report: any[] = [];
let stage = "pause";
let armed = true;
let runner: Runner;
runner = new Runner(store, pool, {
  delayMs: 0,
  collect: async (page, p, q, onPhase, signal, options) =>
    collect(
      page,
      p,
      q,
      (phase, details) => {
        onPhase(phase, details);
        if (phase !== "submitted")
          console.log(JSON.stringify({ platform: p, stage, phase }));
        if (armed && phase === "submitted") {
          armed = false;
          void (async () => {
            if (stage === "pause") {
              // Wait until the platform has persisted an identifiable conversation and question.
              for (let i = 0; i < 30 && !signal.aborted; i++) {
                const humans = await page
                  .locator(selectors[p].human)
                  .allInnerTexts()
                  .catch(() => []);
                if (
                  humans.some((t) => t.trim() === q.trim()) &&
                  /(?:chat\/[^/]+\/[^/]+|chat\/\d+|chat\/s\/)/.test(page.url())
                )
                  break;
                await new Promise((r) => setTimeout(r, 500));
              }
              onPhase("submitted");
            }
            if (!signal.aborted) {
              console.log(
                JSON.stringify({
                  platform: p,
                  stage,
                  action: stage,
                  url: page.url(),
                }),
              );
              await (stage === "pause"
                ? runner.pause()
                : runner.cancel(Number(store.activeBatch()!.id)));
            }
          })();
        }
      },
      signal,
      options,
    ),
});
try {
  for (const platform of platformIds.filter(
    (p) =>
      !process.env.SEEGEO_LIVE_PLATFORM ||
      p === process.env.SEEGEO_LIVE_PLATFORM,
  )) {
    stage = "pause";
    armed = true;
    const q = store.questions().find((q) => q.text.startsWith("请联网"))!;
    const batch = await runner.create([platform], [q.id]);
    await runner.work();
    const paused = store.tasks({ batchId: batch })[0];
    if (paused.status !== "paused") {
      report.push({
        platform,
        stage,
        status: paused.status,
        error: paused.error,
      });
      await runner.cancel(batch);
      continue;
    }
    assert.equal(paused.phase, "submitted");
    await runner.resume();
    await runner.work();
    const recovered = store.tasks({ batchId: batch })[0];
    report.push({
      platform,
      stage: "pause-resume",
      status: recovered.status,
      answerLength: recovered.answer?.length,
      sources: recovered.sources.length,
      attempts: store.attempts(recovered.id),
    });
    console.log(JSON.stringify(report.at(-1)));
    if (!["succeeded", "partial"].includes(recovered.status)) {
      await runner.cancel(batch);
      continue;
    }
    stage = "cancel";
    armed = true;
    const cancelQuestion = store.questions().find((item) => item.id !== q.id)!;
    const cancelledBatch = await runner.create([platform], [cancelQuestion.id]);
    await runner.work();
    // Await the queued command as well as the worker's aborted operation.
    await runner.cancel(cancelledBatch);
    assert.equal(store.batch(cancelledBatch)?.control_state, "cancelled");
    assert.equal(store.hasUnfinished(), false);
    stage = "rerun";
    armed = false;
    const rerun = await runner.rerun(cancelledBatch);
    await runner.work();
    const result = store.tasks({ batchId: rerun })[0];
    report.push({
      platform,
      stage: "cancel-rerun",
      cancelledStatus: store.tasks({ batchId: cancelledBatch })[0].status,
      status: result.status,
      answerLength: result.answer?.length,
      sources: result.sources.length,
    });
    console.log(JSON.stringify(report.at(-1)));
    if (store.hasUnfinished()) await runner.cancel(rerun);
  }
} finally {
  await runner.stop();
  const path = join(dataDir, "diagnostics", `live-controls-${stamp}.json`);
  writeFileSync(
    path,
    JSON.stringify({ createdAt: new Date().toISOString(), report }, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      reportFile: path,
      summary: report.map(({ platform, stage, status }) => ({
        platform,
        stage,
        status,
      })),
    }),
  );
  store.close();
}
