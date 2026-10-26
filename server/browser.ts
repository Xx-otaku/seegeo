import { chromium, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { dataDir, prepareDataDir } from "./config.js";
import { type Platform } from "./types.js";
export const platformUrls: Record<Platform, string> = {
  doubao: "https://www.doubao.com/chat/",
  deepseek: "https://chat.deepseek.com/",
  yuanbao: "https://yuanbao.tencent.com/chat/",
};
export class BrowserPool {
  private contexts = new Map<Platform, BrowserContext>();
  async page(platform: Platform): Promise<Page> {
    prepareDataDir();
    let context = this.contexts.get(platform);
    if (!context) {
      context = await chromium.launchPersistentContext(
        join(dataDir, "profiles", platform),
        {
          channel: "chrome",
          headless: false,
          viewport: { width: 1280, height: 900 },
          locale: "zh-CN",
          timezoneId: "Asia/Shanghai",
          acceptDownloads: false,
          args: ["--no-first-run", "--no-default-browser-check"],
        },
      );
      this.contexts.set(platform, context);
      context.on("close", () => this.contexts.delete(platform));
    }
    return context.pages()[0] || (await context.newPage());
  }
  async login(platform: Platform) {
    const page = await this.page(platform);
    await page.goto(platformUrls[platform], {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.bringToFront();
    return page;
  }
  async close() {
    await Promise.allSettled([...this.contexts.values()].map((c) => c.close()));
    this.contexts.clear();
  }
}
