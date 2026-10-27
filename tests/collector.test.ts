import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { extractSources, isComplete } from "../server/collector.js";
let browser: Browser, page: Page;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CI ? {} : { channel: "chrome" }),
  });
  page = await browser.newPage();
});
after(async () => {
  await browser?.close();
});
function fixture(count = 1) {
  return `<a href="https://old.example.com">旧页面无关链接</a><div id="response"><div class="ds-message"><div class="ds-assistant-message-main-content"><p>本次回答<a href="https://source.example.com/article" aria-label="1"><span class="ds-markdown-cite">1</span></a></p></div><button onclick="document.querySelector('#panel').hidden=false">${count} 个网页</button></div><button aria-label="朗读">朗读</button></div><div id="panel" hidden><a href="https://source.example.com/article"><span class="site_logo_back"></span><span>官方网站</span><span class="ds-markdown-cite">1</span><div class="search-view-card__title">来源文章标题</div><div class="search-view-card__snippet">平台展示的摘要</div></a></div>`;
}
test("sources remain scoped to current answer; actual citations and search references are separate", async () => {
  await page.setContent(fixture());
  const result = await extractSources(
    page,
    "deepseek",
    page.locator(".ds-assistant-message-main-content"),
  );
  assert.equal(result.status, "extracted");
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources.filter((s) => s.kind === "citation").length, 1);
  assert.equal(
    result.sources.find((s) => s.kind === "citation")?.title,
    "来源文章标题",
  );
  assert.equal(result.sources.find((s) => s.kind === "citation")?.marker, "1");
  assert.ok(result.sources.every((s) => !s.url.includes("old.example")));
  assert.ok(
    result.sources
      .find((s) => s.kind === "citation")
      ?.passage?.includes("本次回答"),
  );
});
test("a visibly incomplete source panel must be extraction failure rather than no sources or success", async () => {
  await page.setContent(fixture(2));
  const result = await extractSources(
    page,
    "deepseek",
    page.locator(".ds-assistant-message-main-content"),
  );
  assert.equal(result.status, "failed");
  assert.equal(result.sources.length, 2);
});
test("an answer without source indicators does not collect arbitrary body links", async () => {
  await page.setContent(
    '<a href="https://old.example.com">旧消息来源</a><div class="ds-message"><div class="ds-assistant-message-main-content">无引用的回答</div></div>',
  );
  const result = await extractSources(
    page,
    "deepseek",
    page.locator(".ds-assistant-message-main-content"),
  );
  assert.equal(result.status, "none");
  assert.deepEqual(result.sources, []);
});
test("stable answer text alone is not a completion signal", async () => {
  await page.setContent(
    '<div id="response"><div class="ds-message"><div class="ds-assistant-message-main-content">尚在生成</div></div></div>',
  );
  assert.equal(await isComplete(page, "deepseek"), false);
  await page.setContent(fixture());
  assert.equal(await isComplete(page, "deepseek"), true);
});

test("question ownership ignores only rendering whitespace, never missing or changed words", async () => {
  const { normalizeQuestion } = await import("../server/collector.js");
  assert.equal(
    normalizeQuestion(
      "睢宁500平水包砂工程，鑫君威和三棵树怎么比总成本和供货？",
    ),
    normalizeQuestion(
      "睢宁 500 平水包砂工程，鑫君威和三棵树怎么比总成本和供货？",
    ),
  );
  assert.notEqual(
    normalizeQuestion("睢宁500平真石漆"),
    normalizeQuestion("睢宁500平水包砂"),
  );
});
