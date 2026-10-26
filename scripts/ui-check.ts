import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const root = process.env.SEEGEO_URL || "http://127.0.0.1:4317";
const dir = resolve(".impeccable/review");
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(root);
await page.getByRole("heading", { name: "问题监测", exact: true }).waitFor();
await page.waitForTimeout(700);
await page.screenshot({ path: dir + "/desktop.png", fullPage: true });
await page.getByRole("button", { name: "采集记录", exact: true }).click();
await page.getByRole("heading", { name: "采集记录", exact: true }).waitFor();
await page.screenshot({ path: dir + "/records.png", fullPage: true });
const question = page.locator(".question-link").first();
if (await question.count()) {
  await question.click();
  await page.getByRole("button", { name: "三平台对照", exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".platform-column").count(), 3);
  await page.screenshot({ path: dir + "/comparison.png", fullPage: true });
}
await page.getByRole("button", { name: "运行设置", exact: true }).click();
await page.getByRole("heading", { name: "采集计划", exact: true }).waitFor();
await page.screenshot({ path: dir + "/settings.png", fullPage: true });
await page.getByRole("button", { name: /^问题库/ }).click();
await page.getByRole("button", { name: "导入问题", exact: true }).click();
await page.locator("textarea").waitFor();
await page.screenshot({ path: dir + "/import.png", fullPage: true });
await page.getByRole("button", { name: "关闭导入" }).click();
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
await mobile.goto(root);
await mobile.getByRole("heading", { name: "问题监测", exact: true }).waitFor();
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: dir + "/mobile.png", fullPage: true });
const overflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
assert.equal(overflow, false, "移动端不应产生整页横向溢出");
assert.deepEqual(errors, [], "浏览器不应出现脚本错误");
console.log(
  JSON.stringify({
    screenshots: dir,
    consoleErrors: errors,
    mobileOverflow: overflow,
  }),
);
await browser.close();
