import type { Page, Locator } from "playwright";
import {
  CollectorError,
  type Platform,
  type Capture,
  type Source,
} from "./types.js";
import { platformUrls } from "./browser.js";

export const selectors = {
  deepseek: {
    input: "textarea",
    answer: ".ds-assistant-message-main-content",
    human: ".ds-message",
    stop: '[aria-label="停止生成"], [aria-label="停止回答"]',
  },
  doubao: {
    input:
      '[data-testid="chat_input_input"] [contenteditable="true"], textarea[data-testid="chat_input_input"]',
    answer:
      '[data-testid="receive_message"] [data-testid="message_text_content"]',
    human: '[data-message-role="user"] [data-testid="message_text_content"]',
    stop: '[data-testid="chat_input_local_break_button"]',
  },
  yuanbao: {
    input:
      '.ql-editor[contenteditable="true"], .yb-im-input-editor[contenteditable="true"]',
    answer: '[data-conv-speaker="ai"] .hyc-content-md',
    human: '[data-conv-speaker="human"] .hyc-content-text',
    stop: '#yuanbao-send-btn[aria-label="停止回答"]',
  },
} as const;
/** Platforms may insert presentation whitespace around numbers/CJK; all other characters must match. */
export function normalizeQuestion(value: string) {
  return value.normalize("NFKC").replace(/[\s\u200b\u200c\u200d\ufeff]+/g, "");
}
async function visible(locator: Locator) {
  return await locator
    .first()
    .isVisible()
    .catch(() => false);
}
export async function checkAccess(page: Page) {
  if (/sign_in|login|passport/.test(new URL(page.url()).pathname))
    throw new CollectorError("请先在采集窗口中登录", "login");
  if (
    await visible(
      page.locator(
        '[class*="captcha"] iframe, iframe[src*="captcha"], [id*="captcha"] canvas',
      ),
    )
  )
    throw new CollectorError(
      "平台要求人工验证，请在采集窗口完成后继续",
      "verification",
    );
  if (await visible(page.getByRole("dialog").filter({ hasText: /登录|扫码/ })))
    throw new CollectorError("登录已失效，请在采集窗口重新登录", "login");
}
export async function isComplete(page: Page, p: Platform): Promise<boolean> {
  if (await visible(page.locator(selectors[p].stop))) return false;
  if (p === "deepseek")
    return visible(
      page
        .locator(".ds-message:has(.ds-assistant-message-main-content)")
        .last()
        .locator("..")
        .getByRole("button", { name: "朗读", exact: true }),
    );
  if (p === "doubao")
    return (
      (await page
        .locator(selectors[p].answer)
        .last()
        .getAttribute("data-streaming")) === "false" &&
      (await visible(
        page
          .locator('[data-testid="receive_message"]')
          .last()
          .locator('[data-testid="message_action_copy"]'),
      ))
    );
  return (
    (await page
      .locator(
        '[data-conv-speaker="ai"][data-conv-outputting="false"] .hyc-content-md-done',
      )
      .count()) > 0 &&
    (await visible(
      page
        .locator('[data-conv-speaker="ai"]')
        .last()
        .locator('[aria-label="复制"]')
        .first(),
    ))
  );
}
async function toggle(locator: Locator, target: boolean, name: string) {
  if (!(await visible(locator)))
    throw new CollectorError(`未找到${name}开关，未提交问题`, "mode");
  const state = await locator.first().getAttribute("aria-pressed");
  if (state !== "true" && state !== "false")
    throw new CollectorError(`无法确认${name}状态，未提交问题`, "mode");
  if ((state === "true") !== target) await locator.first().click();
  if ((await locator.first().getAttribute("aria-pressed")) !== String(target))
    throw new CollectorError(`${name}设置未生效，未提交问题`, "mode");
}
async function newConversation(page: Page, p: Platform) {
  await page.goto(platformUrls[p], {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page
    .locator(selectors[p].input)
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(async () => {
      await checkAccess(page);
      throw new CollectorError("找不到聊天输入框，请检查平台页面", "selector");
    });
  await checkAccess(page);
  if (p === "doubao")
    await page.locator('[data-testid="create_conversation_button"]').click();
  if (p === "deepseek")
    await page.getByText("开启新对话", { exact: true }).first().click();
  if (p === "yuanbao") {
    const know = page.getByText("我知道了", { exact: true });
    for (let i = 0; i < 3 && (await visible(know)); i++)
      await know
        .first()
        .click()
        .catch(() => {});
    await page
      .locator('[role="button"][aria-label="新建对话"]')
      .first()
      .click();
  }
  await page.locator(selectors[p].input).first().waitFor({ state: "visible" });
  await page.waitForTimeout(800);
  if (p === "deepseek" && (await page.locator(".ds-message").count()))
    throw new CollectorError("新对话仍包含旧消息，未提交问题", "selector");
  if (
    p === "yuanbao" &&
    (await page.locator('[data-conv-speaker="human"]').count())
  )
    throw new CollectorError("新对话仍包含旧消息，未提交问题", "selector");
  if (
    p === "doubao" &&
    (await page.locator('[data-testid="message_text_content"]').count())
  )
    throw new CollectorError("新对话仍包含旧消息，未提交问题", "selector");
}
async function configureMode(
  page: Page,
  p: Platform,
  allowAuto: boolean,
): Promise<{ model: string | null; mode: Capture["mode"] }> {
  if (p === "deepseek") {
    await toggle(
      page
        .locator(".ds-toggle-button")
        .filter({ hasText: /智能搜索|联网搜索/ }),
      true,
      "智能搜索",
    );
    await toggle(
      page.locator(".ds-toggle-button").filter({ hasText: "深度思考" }),
      false,
      "深度思考",
    );
    return {
      model: null,
      mode: { search: "enabled", thinking: false, searchTriggered: null },
    };
  }
  if (!allowAuto)
    throw new CollectorError(
      "该平台当前采用自动联网，无法确认强制搜索；请在设置中确认采样口径",
      "mode",
    );
  if (p === "doubao") {
    const mode = page.locator('[data-testid="chat_input_action_model"]');
    if (!(await visible(mode)))
      throw new CollectorError("无法确认豆包快速模式", "mode");
    if ((await mode.innerText()).trim() !== "快速") {
      await mode.click();
      await page.getByRole("menuitem", { name: "快速", exact: true }).click();
    }
    if ((await mode.innerText()).trim() !== "快速")
      throw new CollectorError("豆包快速模式未生效", "mode");
    return {
      model: null,
      mode: { search: "auto", thinking: false, searchTriggered: null },
    };
  }
  const mode = page.locator("[data-thinking-mode-switcher-trigger]");
  await mode.click();
  const quick = page.getByRole("menuitemradio").filter({ hasText: "快速回答" });
  await quick.waitFor({ state: "visible" });
  if ((await quick.getAttribute("aria-checked")) !== "true")
    await quick.click();
  const model = await page
    .getByRole("menuitem", { name: "选择模型", exact: true })
    .innerText()
    .catch(() => "");
  await page.keyboard.press("Escape");
  if (!(await mode.innerText()).includes("快速回答"))
    throw new CollectorError("元宝快速回答模式未生效", "mode");
  return {
    model: model.replace(/^模型\s*/, "").trim() || null,
    mode: { search: "auto", thinking: false, searchTriggered: null },
  };
}

/** Only links in the current answer or explicitly opened source panel are eligible. */
export async function extractSources(
  page: Page,
  p: Platform,
  answer: Locator,
): Promise<{
  sources: Source[];
  status: Capture["sourceStatus"];
  searched: boolean | null;
  evidence?: { reported: number; visible: number; citations: "none" | "present" | "unresolved" };
}> {
  const sources: Source[] = [];
  if (p === "yuanbao") {
    const ai = page.locator('[data-conv-speaker="ai"]').last();
    const markers = await answer.locator("[data-idx-list]").evaluateAll((els) =>
      els.flatMap((el) =>
        (el.getAttribute("data-idx-list") || "")
          .split(",")
          .filter(Boolean)
          .map((marker) => ({
            marker,
            passage: (el.closest(".ybc-p") as HTMLElement)?.innerText || "",
          })),
      ),
    );
    const trigger = ai.locator('[data-toolbar-type="citation"]');
    if (!(await visible(trigger)))
      return {
        sources: [],
        status: markers.length ? "failed" : "none",
        searched: markers.length ? true : null,
      };
    await trigger.click();
    await page
      .locator("#chatReferenceList .hyc-common-markdown__ref_card")
      .first()
      .waitFor({ state: "visible", timeout: 7000 });
    const cards = await page
      .locator("#chatReferenceList .hyc-common-markdown__ref_card")
      .evaluateAll((els) =>
        els.map((el) => ({
          url: el.getAttribute("data-url") || "",
          title:
            (
              el.querySelector(
                ".hyc-common-markdown__ref_card-title",
              ) as HTMLElement
            )?.innerText || "",
          site:
            (
              el.querySelector(
                ".hyc-common-markdown__ref_card-foot__txt",
              ) as HTMLElement
            )?.innerText || "",
          snippet:
            (
              el.querySelector(
                ".hyc-common-markdown__ref_card-desc",
              ) as HTMLElement
            )?.innerText || "",
          marker: el.getAttribute("data-idx") || undefined,
        })),
      );
    for (const c of cards)
      if (c.url && c.title) {
        sources.push({
          ...c,
          kind: "search",
          order: sources.filter((s) => s.kind === "search").length + 1,
        });
        const cited = markers.filter((m) => m.marker === c.marker);
        if (cited.length)
          sources.push({
            ...c,
            kind: "citation",
            order: sources.filter((s) => s.kind === "citation").length + 1,
            passage: cited.map((m) => m.passage).join("\n"),
          });
      }
    const expected = Number(
      (await trigger.getAttribute("aria-label"))?.match(/\d+/)?.[0] || 0,
    );
    return {
      sources,
      status:
        cards.length &&
        (!expected || cards.length === expected) &&
        markers.every((m) => cards.some((c) => c.marker === m.marker))
          ? "extracted"
          : "failed",
      searched: true,
    };
  }
  if (p === "doubao") {
    const ai = page.locator('[data-testid="receive_message"]').last();
    const trigger = ai.getByText(/^搜索 .*参考 \d+ 篇资料$/);
    if (!(await visible(trigger))) {
      const chips = await answer.locator('span[class*="container-sWvQla"]').count();
      return {
        sources: [],
        status: chips ? "failed" : "none",
        searched: null,
        evidence: { reported: 0, visible: 0, citations: chips ? "unresolved" : "none" },
      };
    }
    const expected = Number(
      (await trigger.innerText()).match(/参考 (\d+) 篇/)?.[1] || 0,
    );
    if (!(await visible(ai.locator("a[data-thinking-box-tool-call]"))))
      await trigger.click();
    await ai
      .locator("a[data-thinking-box-tool-call]")
      .first()
      .waitFor({ state: "visible", timeout: 7000 });
    const cards = await ai
      .locator("a[data-thinking-box-tool-call]")
      .evaluateAll((els) =>
        els.map((el, i) => ({
          url: (el as HTMLAnchorElement).href,
          title: ((el as HTMLElement).innerText || "").replace(/^\d+\.\s*/, ""),
          snippet: "",
          marker: (el as HTMLElement).innerText.match(/^(\d+)\./)?.[1] || "",
        })),
      );
    for (const c of cards)
      sources.push({
        ...c,
        site: new URL(c.url).hostname,
        kind: "search",
        order: sources.length + 1,
      });
    // Inline Doubao source chips have no URL attributes. Their popovers are inspected separately.
    const chips = answer.locator('span[class*="container-sWvQla"]');
    let unresolved = false;
    for (let i = 0; i < (await chips.count()); i++) {
      await page.mouse.click(5, 5);
      await page.waitForTimeout(500);
      await chips.nth(i).hover();
      await page.waitForTimeout(700);
      const pop = page
        .locator('.semi-popover-wrapper-show[role="tooltip"]')
        .last();
      try {
        if (!(await visible(pop))) await chips.nth(i).click();
        await pop.waitFor({ state: "visible", timeout: 3000 });
        await page.waitForTimeout(400);
        const title = await pop.locator('[class^="title-"]').innerText();
        const site = await pop
          .locator('[class*="footer-website-"]')
          .innerText()
          .catch(() => "");
        // Doubao opens a redirect in a new tab; PDF destinations can immediately
        // become downloads and close the tab before its URL is observable. Capture
        // the redirect request itself, which contains the destination in `target`.
        const context = page.context();
        const redirect = context.waitForEvent("request", {
          predicate: (req) => req.isNavigationRequest() && req.url().startsWith("https://link.wtturl.cn/"),
          timeout: 6000,
        }).then((req) => req.url()).catch(() => "");
        const popupPromise = page.waitForEvent("popup", { timeout: 6000 }).catch(() => null);
        await pop.locator('[class^="title-"]').click();
        const [redirectUrl, popup] = await Promise.all([redirect, popupPromise]);
        let url = redirectUrl;
        if (!url && popup && !popup.isClosed()) {
          await popup.waitForURL((u) => u.protocol === "http:" || u.protocol === "https:", { timeout: 5000, waitUntil: "commit" }).catch(() => {});
          url = popup.url();
        }
        if (popup && !popup.isClosed()) await popup.close().catch(() => {});
        const parsed = new URL(url);
        if (
          parsed.hostname === "link.wtturl.cn" &&
          parsed.searchParams.get("target")
        )
          url = parsed.searchParams.get("target")!;
        if (!/^https?:/.test(url)) throw new Error("来源链接未公开");
        const card = cards.find((c) => c.url === url);
        const passage = await chips.nth(i).locator("..").innerText();
        if (!sources.some((s) => s.kind === "citation" && s.url === url))
          sources.push({
            url,
            title,
            site,
            snippet: "",
            marker: card?.marker,
            kind: "citation",
            order: sources.filter((s) => s.kind === "citation").length + 1,
            passage,
          });
      } catch {
        unresolved = true;
      }
    }
    return {
      sources,
      // The headline reports consulted material, while the expanded list can expose
      // fewer links. Preserve both counts; validate the entire visible numbered list.
      status: cards.length > 0 && cards.length <= expected && cards.every((c, i) => c.marker === String(i + 1) && !!c.url && !!c.title) && !unresolved ? "extracted" : "failed",
      searched: true,
      evidence: { reported: expected, visible: cards.length, citations: unresolved ? "unresolved" : (await chips.count()) ? "present" : "none" },
    };
  }
  const addLinks = async (scope: Locator, kind: Source["kind"]) => {
    const links = await scope
      .locator(
        kind === "citation"
          ? 'a[href]:has(.ds-markdown-cite), a[href][data-citation-index], [class*="citation"] a[href]'
          : "a[href]",
      )
      .evaluateAll((els) =>
        els.map((el) => {
          const a = el as HTMLAnchorElement;
          const parent =
            a.closest(
              '[class*="card"], [class*="item"], [class*="reference"]',
            ) || a;
          return {
            url: a.href,
            title: (a.innerText || a.getAttribute("title") || "").trim(),
            snippet: (parent as HTMLElement).innerText?.trim() || "",
            marker:
              a.getAttribute("aria-label") ||
              a.getAttribute("data-index") ||
              a.getAttribute("data-citation-index") ||
              undefined,
            passage: (a.closest("p, li") as HTMLElement)?.innerText,
          };
        }),
      );
    for (const link of links) {
      let u: URL;
      try {
        u = new URL(link.url);
      } catch {
        continue;
      }
      if (
        !["http:", "https:"].includes(u.protocol) ||
        /(^|\.)(doubao\.com|deepseek\.com|yuanbao\.tencent\.com)$/.test(
          u.hostname,
        )
      )
        continue;
      if (
        !link.title ||
        sources.some((s) => s.kind === kind && s.url === link.url)
      )
        continue;
      sources.push({
        kind,
        url: link.url,
        title: link.title,
        site: u.hostname,
        snippet: link.snippet.slice(0, 3000),
        marker: link.marker,
        passage: link.passage,
        order: sources.filter((s) => s.kind === kind).length + 1,
      });
    }
  };
  // Ordinary inline hyperlinks are visible answer links, but are not automatically search citations.
  const marks = answer.locator(
    '.ds-markdown-cite, [data-testid*="citation"], [class*="citation"], [class*="reference"]',
  );
  const markCount = await marks.count();
  if (markCount) await addLinks(answer, "citation");
  let trigger: Locator;
  if (p === "deepseek")
    trigger = page
      .locator(".ds-message")
      .last()
      .getByText(/^\d+ 个网页$/)
      .last();
  else if (p === "doubao")
    trigger = page
      .locator(
        '[data-testid*="search_reference"], [data-testid*="search_result"]',
      )
      .filter({ hasText: /来源|搜索|参考/ })
      .last();
  else
    trigger = page
      .locator(
        '[class*="search-ref"], [class*="searchRef"], [class*="reference"]',
      )
      .filter({ hasText: /来源|搜索|参考/ })
      .last();
  const hasTrigger = await visible(trigger);
  if (hasTrigger) {
    try {
      await trigger.click({ timeout: 5000 });
      await page.waitForTimeout(700);
    } catch {
      return { sources, status: "failed", searched: true };
    }
    if (p === "deepseek") {
      await page
        .locator(".search-view-card__title")
        .first()
        .waitFor({ state: "visible", timeout: 5000 });
      const cards = await page
        .locator("a:has(.search-view-card__title)")
        .evaluateAll((els) =>
          els.map((el) => ({
            url: (el as HTMLAnchorElement).href,
            title:
              (el.querySelector(".search-view-card__title") as HTMLElement)
                ?.innerText || "",
            snippet:
              (el.querySelector(".search-view-card__snippet") as HTMLElement)
                ?.innerText || "",
            marker:
              el.querySelector(".ds-markdown-cite")?.textContent || undefined,
            site:
              (
                el.querySelector(".site_logo_back")
                  ?.nextElementSibling as HTMLElement
              )?.innerText || "",
          })),
        );
      for (const card of cards)
        sources.push({
          ...card,
          kind: "search",
          order: sources.filter((s) => s.kind === "search").length + 1,
        });
      for (const s of sources.filter((s) => s.kind === "citation")) {
        const card = cards.find((c) => c.url === s.url);
        if (card) {
          s.title = card.title;
          s.snippet = card.snippet;
          s.site = card.site;
          s.marker = card.marker;
        }
      }
      const expected = Number(
        (await trigger.innerText()).match(/\d+/)?.[0] || 0,
      );
      if (
        (expected && cards.length !== expected) ||
        sources.some(
          (s) => s.kind === "citation" && !cards.some((c) => c.url === s.url),
        )
      )
        return { sources, status: "failed", searched: true };
    } else {
      const panel = page.locator(
        '[role="dialog"], [class*="search-reference"], [class*="search-result"], [class*="reference-panel"]',
      );
      if (await visible(panel)) await addLinks(panel, "search");
    }
  }
  if (sources.length) return { sources, status: "extracted", searched: true };
  return {
    sources,
    status: markCount || hasTrigger ? "failed" : "none",
    searched: markCount || hasTrigger ? true : null,
  };
}

export async function collect(
  page: Page,
  p: Platform,
  question: string,
  onPhase: (
    phase: string,
    details?: { mode: Capture["mode"]; model: string | null },
  ) => void,
  signal: AbortSignal,
  options = { allowAutoSearch: false, timeoutMs: 300000 },
): Promise<Capture> {
  const startedAt = new Date().toISOString();
  let submitted = false;
  const abort = () => {
    if (signal.aborted)
      throw new CollectorError(
        "任务已暂停，需核对原会话后继续",
        "cancelled",
        submitted,
      );
  };
  try {
    abort();
    onPhase("opening");
    await newConversation(page, p);
    abort();
    onPhase("mode");
    const mode = await configureMode(page, p, options.allowAutoSearch);
    onPhase("mode_ready", mode);
    const input = page.locator(selectors[p].input).first();
    await input.fill(question);
    const value = await input.evaluate((el) =>
      el instanceof HTMLTextAreaElement
        ? el.value
        : (el as HTMLElement).innerText,
    );
    if (value.trim() !== question.trim())
      throw new CollectorError(
        "输入框中的问题与原文不一致，未提交",
        "selector",
      );
    abort();
    onPhase("submitting");
    submitted = true;
    await input.press("Enter");
    onPhase("submitted");
    const answer = page.locator(selectors[p].answer).last();
    let previous = "",
      stable = 0,
      userConfirmed = false;
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
      abort();
      await checkAccess(page);
      const text = await answer.innerText({ timeout: 1000 }).catch(() => "");
      const generating =
        (await visible(page.locator(selectors[p].stop))) ||
        (p === "yuanbao" &&
          (await page
            .locator('[data-conv-speaker="ai"][data-conv-outputting="true"]')
            .count()) > 0);
      userConfirmed ||= (
        await page.locator(selectors[p].human).allInnerTexts()
      ).some((t) => normalizeQuestion(t) === normalizeQuestion(question));
      onPhase("submitted");
      stable = text && text === previous ? stable + 1 : 0;
      previous = text;
      // A platform completion toolbar is required; text stability alone is insufficient.
      const done = await isComplete(page, p);
      if (text && stable >= 3 && !generating && done) break;
      await page.waitForTimeout(2000);
    }
    if (!previous || stable < 3 || Date.now() >= deadline)
      throw new CollectorError(
        "回答生成未确认完成，保留为未完成结果",
        "timeout",
        true,
        {
          answer: previous,
          conversationUrl: page.url(),
          startedAt,
          finishedAt: new Date().toISOString(),
          ...mode,
        },
      );
    if (
      previous.trim().length < 80 &&
      /^(服务器繁忙|服务繁忙|网络异常|请求失败|系统繁忙)/.test(previous.trim())
    )
      throw new CollectorError(
        "平台返回服务错误：" + previous.trim(),
        "uncertain",
        true,
      );
    const human = page.locator(selectors[p].human);
    const texts = await human.allInnerTexts();
    if (
      !userConfirmed &&
      !texts.some((t) => normalizeQuestion(t) === normalizeQuestion(question))
    )
      throw new CollectorError(
        "无法将回答与本次问题核对，需人工检查会话",
        "uncertain",
        true,
        { answer: previous, conversationUrl: page.url(), ...mode },
      );
    onPhase("extracting");
    const html = await answer.innerHTML();
    const extracted = await extractSources(page, p, answer).catch(() => ({
      sources: [] as Source[],
      status: "failed" as const,
      searched: null,
    }));
    mode.mode.searchTriggered = extracted.searched;
    if ("evidence" in extracted && extracted.evidence) mode.mode.sourceEvidence = extracted.evidence;
    return {
      answer: previous,
      html,
      sources: extracted.sources,
      sourceStatus: extracted.status,
      conversationUrl: page.url(),
      startedAt,
      finishedAt: new Date().toISOString(),
      ...mode,
    };
  } catch (e) {
    if (e instanceof CollectorError) {
      e.submitted ||= submitted;
      throw e;
    }
    throw new CollectorError(
      e instanceof Error ? e.message : String(e),
      submitted ? "uncertain" : "network",
      submitted,
    );
  }
}

export async function recoverExisting(
  page: Page,
  p: Platform,
  question: string,
  mode: Capture["mode"],
  model: string | null = null,
  startedAt = new Date().toISOString(),
  signal?: AbortSignal,
  timeoutMs = 300000,
): Promise<Capture> {
  await page
    .locator(selectors[p].input)
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1500);
  await checkAccess(page);
  // Inputs can become visible before the SPA restores its conversation messages.
  const questionDeadline = Date.now() + Math.min(timeoutMs, 15000);
  let confirmed = false;
  while (Date.now() < questionDeadline) {
    if (signal?.aborted)
      throw new CollectorError("原会话恢复已中断", "cancelled", true);
    await checkAccess(page);
    let humans = await page.locator(selectors[p].human).allInnerTexts();
    confirmed = humans.some(
      (t) => normalizeQuestion(t) === normalizeQuestion(question),
    );
    if (confirmed) break;
    if (p === "doubao") {
      const list = page.locator('[data-testid="message-list"]');
      if (await list.count())
        await list.evaluate((el) => {
          let node: HTMLElement | null = el as HTMLElement;
          while (node) {
            if (node.scrollHeight > node.clientHeight + 10) node.scrollTop = 0;
            node = node.parentElement;
          }
        });
    }
    await page.waitForTimeout(1000);
  }
  if (!confirmed)
    throw new CollectorError(
      "原会话中无法核对问题原文，不能自动恢复",
      "uncertain",
      true,
    );
  const answer = page.locator(selectors[p].answer).last();
  const deadline = Date.now() + timeoutMs;
  let text = "",
    previous = "",
    stable = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted)
      throw new CollectorError("原会话恢复已中断", "cancelled", true);
    await checkAccess(page);
    if (await answer.count()) {
      text = await answer.innerText();
      const complete = await isComplete(page, p);
      if (
        complete &&
        text &&
        text === previous &&
        !(await visible(page.locator(selectors[p].stop)))
      )
        stable++;
      else stable = 0;
      previous = text;
      if (stable >= 2) break;
    }
    await page.waitForTimeout(1500);
  }
  if (stable < 2)
    throw new CollectorError("原会话未在等待时间内完成", "timeout", true);
  if (signal?.aborted)
    throw new CollectorError("原会话恢复已中断", "cancelled", true);
  const extracted = await extractSources(page, p, answer).catch(() => ({
    sources: [] as Source[],
    status: "failed" as const,
    searched: null,
  }));
  return {
    answer: text,
    html: await answer.innerHTML(),
    sources: extracted.sources,
    sourceStatus: extracted.status,
    mode: { ...mode, searchTriggered: extracted.searched, ...("evidence" in extracted && extracted.evidence ? { sourceEvidence: extracted.evidence } : {}) },
    model,
    conversationUrl: page.url(),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
