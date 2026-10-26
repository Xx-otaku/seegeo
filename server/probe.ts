import { BrowserPool } from "./browser.js";
import { platformIds, type Platform } from "./types.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./config.js";
import Fastify from "fastify";
const pool = new BrowserPool();
const chosen =
  process.argv[3] === "all"
    ? platformIds
    : [(process.argv[3] as Platform) || "deepseek"];
for (const platform of chosen) {
  if (!platformIds.includes(platform))
    throw new Error("平台须为 doubao / deepseek / yuanbao / all");
  const page = await pool.login(platform);
  console.log(`已打开 ${platform}，请在独立 Chrome 窗口中手动登录。`);
  const dir = join(dataDir, "diagnostics");
  mkdirSync(dir, { recursive: true });
  setInterval(async () => {
    if (page.isClosed()) return;
    try {
      writeFileSync(
        join(dir, `probe-${platform}.json`),
        JSON.stringify(
          {
            url: page.url(),
            text: await page.locator("body").innerText(),
            elements: await page
              .locator(
                "textarea, [contenteditable=true], button, [role=button], [data-testid]",
              )
              .evaluateAll((els) =>
                els.map((el) => ({
                  tag: el.tagName,
                  testid: el.getAttribute("data-testid"),
                  role: el.getAttribute("role"),
                  label: el.getAttribute("aria-label"),
                  pressed: el.getAttribute("aria-pressed"),
                  state: el.getAttribute("data-state"),
                  placeholder: el.getAttribute("placeholder"),
                  cls: el.className,
                  text: (el.textContent || "").slice(0, 180),
                })),
              ),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch {}
  }, 10000).unref();
}
console.log(
  "登录窗口保持打开。Ctrl+C 退出验证工具。页面快照仅保存在本机诊断目录。",
);
const api = Fastify();
api.addHook("onRequest", async (req, reply) => {
  if (req.headers.origin)
    return reply.code(403).send({ error: "调试接口仅供本机终端使用" });
});
api.post<{
  Params: { platform: Platform };
  Body: {
    selector?: string;
    click?: string;
    hover?: string;
    scroll?: string;
    text?: string;
  };
}>("/inspect/:platform", async (req) => {
  if (!platformIds.includes(req.params.platform)) throw new Error("未知平台");
  const page = await pool.page(req.params.platform);
  if (req.body.click)
    await page.locator(req.body.click).first().click({ timeout: 5000 });
  if (req.body.hover) await page.locator(req.body.hover).first().hover();
  if (req.body.scroll)
    await page.locator(req.body.scroll).evaluate((el) => {
      let p: HTMLElement | null = el as HTMLElement;
      while (p) {
        if (p.scrollHeight > p.clientHeight + 10) p.scrollTop = 0;
        p = p.parentElement;
      }
    });
  return {
    url: page.url(),
    text: (await page.locator("body").innerText()).slice(-14000),
    html: req.body.selector
      ? await page
          .locator(req.body.selector)
          .evaluateAll((els) => els.map((el) => el.outerHTML).slice(-20))
      : [],
  };
});
api.post<{ Params: { platform: Platform }; Body: { question: string } }>(
  "/capture/:platform",
  async (req) => {
    const moduleUrl = new URL("./collector.ts", import.meta.url);
    moduleUrl.searchParams.set("v", String(Date.now()));
    const { collect } = await import(moduleUrl.href);
    const page = await pool.page(req.params.platform);
    try {
      const result = await collect(
        page,
        req.params.platform,
        req.body.question,
        (phase: string) => console.log(req.params.platform, phase),
        new AbortController().signal,
        { allowAutoSearch: true, timeoutMs: 180000 },
      );
      writeFileSync(
        join(
          dataDir,
          "diagnostics",
          `capture-${req.params.platform}-${Date.now()}.json`,
        ),
        JSON.stringify(result, null, 2),
        { mode: 0o600 },
      );
      return result;
    } catch (e) {
      console.error(e);
      return { error: String(e) };
    }
  },
);
api.post<{
  Params: { platform: Platform };
  Body: { question: string; url?: string };
}>("/recover/:platform", async (req) => {
  const moduleUrl = new URL("./collector.ts", import.meta.url);
  moduleUrl.searchParams.set("v", String(Date.now()));
  const { recoverExisting } = await import(moduleUrl.href);
  const p = req.params.platform;
  const page = await pool.page(p);
  if (req.body.url)
    await page.goto(req.body.url, { waitUntil: "domcontentloaded" });
  try {
    const result = await recoverExisting(page, p, req.body.question, {
      search: p === "deepseek" ? "enabled" : "auto",
      thinking: false,
      searchTriggered: null,
    });
    writeFileSync(
      join(dataDir, "diagnostics", `capture-${p}-${Date.now()}.json`),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    return result;
  } catch (e) {
    return { error: String(e) };
  }
});
await api.listen({ host: "127.0.0.1", port: 4318 });
process.on("SIGINT", async () => {
  await pool.close();
  process.exit();
});
await new Promise(() => {});
