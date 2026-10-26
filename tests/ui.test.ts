import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Route } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";

test(
  "真实Chrome面板按钮链：导入编辑启停移除导出、任务控制、登录及恢复",
  { timeout: 45000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "seegeo-ui-"));
    const store = new Store(join(dir, "seegeo.sqlite"));
    store.setSetting("schedule", { ...store.schedule, enabled: false });
    store.setSetting("notifications", false);
    store.importQuestions([{ text: "按钮回归原问题", group_name: "验收" }]);
    const q = store.questions()[0];
    const batch = store.createBatch("test", ["doubao"]);
    const task = store.tasks()[0];
    store.completeTask(task.id, {
      answer: "已保存的长回答\n".repeat(20),
      html: "<p>已保存的长回答</p>",
      sources: [],
      sourceStatus: "failed",
      mode: { search: "auto", thinking: false, searchTriggered: false },
      model: null,
      conversationUrl: "https://www.doubao.com/chat/123",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    store.db
      .prepare(
        "UPDATE batches SET control_state='completed',finished_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), batch);
    store.close();
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((r) => socket.close(() => r()));
    const root = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "server/index.ts"],
      {
        env: {
          ...process.env,
          SEEGEO_DATA_DIR: dir,
          SEEGEO_PORT: String(port),
        },
        stdio: "ignore",
      },
    );
    const browser = await chromium.launch({
      channel: process.env.CI ? undefined : "chrome",
      headless: true,
    });
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(7000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const calls: string[] = [];
    let virtual: any = null;
    let seq = 100;
    const fulfill = (r: Route, body: unknown) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    // Only browser-executing commands use an explicit deterministic fixture.
    // CRUD/settings/export below reach the real isolated HTTP server and SQLite.
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/state") {
        const state = await (await route.fetch()).json();
        if (virtual) {
          const active = !virtual.finished_at;
          const op = (enabled: boolean) => ({
            enabled,
            reason: enabled ? null : "请先完成或取消当前批次",
          });
          const paused = virtual.control_state === "paused";
          Object.assign(state, {
            paused,
            busy: active && !paused,
            activeBatch: active ? virtual : null,
            displayBatch: virtual,
            batches: [virtual, ...state.batches],
            controls: {
              start: op(!active),
              pause: op(active && !paused),
              resume: op(active && paused),
              cancel: op(active),
              rerun: op(!active),
            },
          });
        }
        return fulfill(route, state);
      }
      const command =
        route.request().method() === "POST" &&
        (path === "/api/batches" ||
          path === "/api/pause" ||
          path === "/api/resume" ||
          /^\/api\/(batches\/\d+\/(cancel|rerun)|tasks\/\d+\/(retry|recover|open)|platforms\/.+\/login)$/.test(
            path,
          ));
      if (command) {
        calls.push(path);
        await new Promise((r) => setTimeout(r, 60));
        if (path === "/api/batches" || /\/(retry|rerun)$/.test(path))
          virtual = {
            id: seq++,
            control_state: "running",
            trigger: "manual",
            created_at: new Date().toISOString(),
            finished_at: null,
            total: 3,
            succeeded: 0,
            partial: 0,
            failed: 0,
            cancelled: 0,
            waiting: 0,
            running: 1,
            pending: 2,
            paused: 0,
          };
        if (path === "/api/pause") virtual.control_state = "paused";
        if (path === "/api/resume") virtual.control_state = "running";
        if (path.endsWith("/cancel")) {
          virtual.control_state = "cancelled";
          virtual.finished_at = new Date().toISOString();
          virtual.cancelled = 3;
        }
        return fulfill(route, { ok: true, batchId: virtual?.id });
      }
      await route.continue();
    });
    try {
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(root + "/api/state")).ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 40));
      }
      await page.goto(root);
      await page
        .getByRole("heading", { name: "问题监测", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "导入问题", exact: true }).click();
      await page.getByLabel("问题内容").fill("新增测试问题\n批量待移除问题");
      await page
        .getByRole("button", { name: "导入问题", exact: true })
        .last()
        .click();
      await page
        .getByRole("button", { name: "新增测试问题", exact: true })
        .waitFor();
      const qs = await (await fetch(root + "/api/questions")).json();
      const added = qs.find((v: any) => v.text === "新增测试问题").id;
      await page.getByLabel(`编辑问题 ${added}`, { exact: true }).click();
      await page.locator(".edit-panel textarea").fill("已编辑的测试问题");
      await page.getByRole("button", { name: "保存修改", exact: true }).click();
      await page
        .getByRole("button", { name: "已编辑的测试问题", exact: true })
        .waitFor();
      await page.getByLabel(`启用问题 ${added}`, { exact: true }).click();
      await page.waitForTimeout(100);
      assert.equal(
        (await (await fetch(root + "/api/questions/" + added)).json()).enabled,
        0,
      );
      await page.getByRole("button", { name: "开始一轮", exact: true }).click();
      await page.getByRole("button", { name: "确认开始", exact: true }).click();
      await page.getByText("正在监测", { exact: true }).waitFor();
      await page.getByRole("button", { name: "暂停监测", exact: true }).click();
      await page
        .getByRole("button", { name: "继续监测", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "继续监测", exact: true }).click();
      await page
        .getByRole("button", { name: "暂停监测", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "取消监测", exact: true }).click();
      await page
        .getByRole("button", { name: "重新运行本轮", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "重新运行本轮", exact: true })
        .click();
      await page.getByText("正在监测", { exact: true }).waitFor();
      await page.getByRole("button", { name: "取消监测", exact: true }).click();
      await page.getByRole("button", { name: "采集记录", exact: true }).click();
      await page.locator(".question-link").first().click();
      await page
        .getByRole("button", { name: "查看原会话", exact: true })
        .click();
      await page.waitForTimeout(100);
      await page
        .getByRole("button", { name: "核对并恢复", exact: true })
        .click();
      await page.waitForTimeout(100);
      await page
        .getByRole("button", { name: "另开对话重采", exact: true })
        .click();
      await page.getByText("正在监测", { exact: true }).waitFor();
      await page.getByRole("button", { name: "取消监测", exact: true }).click();
      await page.getByRole("button", { name: "运行设置", exact: true }).click();
      for (const button of await page
        .getByRole("button", { name: "打开登录窗口" })
        .all()) {
        await button.click();
        await page.waitForTimeout(100);
      }
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      await page.waitForTimeout(150);
      await page.getByRole("button", { name: /^问题库/ }).click();
      const download = page.waitForEvent("download");
      await page.getByLabel("导出全部结果").selectOption("results.json");
      assert.ok((await download).suggestedFilename().endsWith("results.json"));
      page.once("dialog", (d) => d.accept());
      await page.getByLabel(`移出问题 ${added}`, { exact: true }).click();
      await page.waitForTimeout(150);
      assert.equal(
        (await (await fetch(root + "/api/questions")).json()).some(
          (v: any) => v.id === added,
        ),
        false,
      );
      assert.ok(calls.includes("/api/pause") && calls.includes("/api/resume"));
      assert.ok(calls.some((x) => x.endsWith("/retry")));
      assert.ok(calls.some((x) => x.endsWith("/recover")));
      assert.equal(calls.filter((x) => x.endsWith("/login")).length, 3);
      assert.match(await page.locator(".repo-link").innerText(), /v0\.2\.0/);
      await page.getByLabel("选择当前筛选的全部问题").check();
      const bulk = page.getByRole("button", {
        name: "删除所选（2）",
        exact: true,
      });
      await bulk.waitFor();
      page.once("dialog", (d) => d.dismiss());
      await bulk.click();
      assert.equal(
        (await (await fetch(root + "/api/questions")).json()).length,
        2,
      );
      page.once("dialog", (d) => d.accept());
      await bulk.click();
      await page
        .getByRole("heading", { name: "先把你的问题放进来", exact: true })
        .waitFor();
      assert.equal(await page.locator(".selection-bar").count(), 0);
      assert.equal(
        (await (await fetch(root + "/api/results")).json()).length,
        1,
      );
      assert.deepEqual(errors, []);
      assert.equal(q.id, 1);
    } finally {
      await browser.close();
      child.kill("SIGTERM");
      await once(child, "close");
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
