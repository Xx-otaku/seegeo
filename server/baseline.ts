import { z } from "zod";
import type { Task } from "./types.js";

export const structureNames = [
  "标题",
  "概要",
  "引言",
  "结论",
  "具体内容",
  "实际案例",
  "对比表格",
  "FAQ",
  "边界描述",
  "行动指引",
] as const;
export const baselineConfigSchema = z
  .object({
    brands: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(60),
          aliases: z.array(z.string().trim().min(1).max(60)).max(20),
        }),
      )
      .min(1)
      .max(30),
  })
  .superRefine((value, ctx) => {
    const names = new Set<string>();
    const aliases = new Map<string, string>();
    for (const b of value.brands) {
      const key = b.name.normalize("NFKC").toLowerCase();
      if (names.has(key))
        ctx.addIssue({ code: "custom", message: "品牌名不能重复" });
      names.add(key);
      for (const alias of new Set([b.name, ...b.aliases])) {
        const a = alias.normalize("NFKC").toLowerCase();
        if (aliases.has(a) && aliases.get(a) !== b.name)
          ctx.addIssue({
            code: "custom",
            message: `别名 ${alias} 被多个品牌使用`,
          });
        aliases.set(a, b.name);
      }
    }
  });
export type BaselineConfig = z.infer<typeof baselineConfigSchema>;
export const defaultBaselineConfig: BaselineConfig = {
  brands: [
    { name: "鑫君威", aliases: [] },
    { name: "三棵树", aliases: [] },
    { name: "嘉宝莉", aliases: [] },
  ],
};
export const reviewSchema = z
  .object({
    target: z.string().trim().min(1).max(60),
    sentiment: z
      .enum(["positive", "neutral", "negative", "mixed"])
      .nullable()
      .default(null),
    top3: z
      .array(z.string().trim().min(1).max(60))
      .max(3)
      .nullable()
      .default(null),
    rankingNotApplicable: z.boolean().default(false),
    note: z.string().max(2000).default(""),
  })
  .refine((r) => !r.rankingNotApplicable || r.top3 === null, {
    message: "无法判定排名时不要同时填写前三品牌",
  });
export type BaselineReview = z.infer<typeof reviewSchema>;
export type ReviewMap = Record<string, BaselineReview>;
const normalized = (s: string) => s.normalize("NFKC").toLowerCase();
function occurrences(text: string, aliases: string[]) {
  const value = normalized(text),
    used = new Set<number>();
  let count = 0;
  for (const alias of [...new Set(aliases.map(normalized))].sort(
    (a, b) => b.length - a.length,
  )) {
    let start = 0,
      index = -1;
    while ((index = value.indexOf(alias, start)) >= 0) {
      start = index + alias.length;
      const left = value[index - 1] || "",
        right = value[start] || "";
      if (
        (/^[a-z0-9]/.test(alias) && /[a-z0-9]/.test(left)) ||
        (/[a-z0-9]$/.test(alias) && /[a-z0-9]/.test(right))
      )
        continue;
      const positions = Array.from(
        { length: alias.length },
        (_, i) => index + i,
      );
      if (positions.some((i) => used.has(i))) continue;
      positions.forEach((i) => used.add(i));
      count++;
    }
  }
  return count;
}
export function website(url: string) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol)
      ? u.hostname.toLowerCase().replace(/^www\./, "")
      : "无法识别的网站";
  } catch {
    return "无法识别的网站";
  }
}
export function canonicalSource(url: string) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^utm_/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return u.href;
  } catch {
    return url;
  }
}
const size = (s: string) => [...s.replace(/\s/g, "")].length;
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
export function structureBreakdown(task: Pick<Task, "answer" | "answer_html">) {
  const counts = Object.fromEntries(
    structureNames.map((k) => [k, 0]),
  ) as Record<(typeof structureNames)[number], number>;
  let text = task.answer || "";
  if (task.answer_html) {
    text = task.answer_html
      .replace(
        /<table\b[^>]*>([\s\S]*?)<\/table>/gi,
        (_, t) => `\n[SG_TABLE]${plain(t)}[/SG_TABLE]\n`,
      )
      .replace(
        /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
        (_, n, t) => `\n${"#".repeat(Number(n))} ${plain(t)}\n`,
      )
      .replace(/<\/(?:p|div|li|ul|ol|blockquote)>|<br\s*\/?>/gi, "\n");
    text = plain(text);
  }
  let current: (typeof structureNames)[number] = "具体内容";
  for (const line of text.split(/\n/)) {
    const clean = line.trim();
    if (!clean) continue;
    if (clean.includes("[SG_TABLE]")) {
      counts["对比表格"] += size(clean.replace(/\[\/?SG_TABLE\]/g, ""));
      continue;
    }
    if (/^\|.*\|$/.test(clean)) {
      if (!/^\|[\s:|\-]+\|$/.test(clean))
        counts["对比表格"] += size(clean.replace(/\|/g, ""));
      continue;
    }
    const heading = clean
      .replace(/^#{1,6}\s*|^[一二三四五六七八九十\d]+[、.．)）]\s*/g, "")
      .replace(/[：:]$/g, "");
    let kind: (typeof structureNames)[number] | null = null;
    if (heading.length <= 30) {
      if (/^(概要|摘要|概览|要点概述|简要概括)/.test(heading)) kind = "概要";
      else if (/^(引言|前言|背景介绍|背景)$/.test(heading)) kind = "引言";
      else if (/^(结论|总结|小结|总的来说|结语)/.test(heading)) kind = "结论";
      else if (/^(实际案例|案例|应用实例|实例)/.test(heading))
        kind = "实际案例";
      else if (/^(FAQ|常见问题|常见问答|问答)/i.test(heading)) kind = "FAQ";
      else if (
        /^(边界描述|适用范围|适用边界|局限|限制|注意事项|不适用)/.test(heading)
      )
        kind = "边界描述";
      else if (/^(行动指引|行动建议|下一步|操作建议|如何行动)/.test(heading))
        kind = "行动指引";
      else if (/^(具体内容|正文|详细内容)/.test(heading)) kind = "具体内容";
    }
    if (/^#\s+/.test(clean)) {
      counts["标题"] += size(heading);
      if (kind) current = kind;
      continue;
    }
    if (kind) {
      current = kind;
      counts[current] += size(heading);
      continue;
    }
    counts[current] += size(clean.replace(/^#{2,6}\s*/, ""));
  }
  return counts;
}
function automaticRanking(answer: string, config: BaselineConfig) {
  const ranks = new Map<string, number>();
  for (const match of answer.matchAll(
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?([1-9]|10)[.、．)）]\s*(.{1,120})/g,
  )) {
    const rank = Number(match[1]),
      lead = normalized(match[2].slice(0, 80).replace(/^[\s*【\[]+/, ""));
    for (const b of config.brands)
      if (
        [b.name, ...b.aliases].some(
          (alias) =>
            lead.startsWith(normalized(alias)) &&
            occurrences(lead, [alias]) > 0,
        )
      )
        ranks.set(b.name, Math.min(ranks.get(b.name) ?? 99, rank));
  }
  return ranks.size
    ? config.brands
        .filter((b) => (ranks.get(b.name) ?? 99) <= 3)
        .sort((a, b) => ranks.get(a.name)! - ranks.get(b.name)!)
        .map((b) => b.name)
    : null;
}
export function buildBaseline(
  tasks: Task[],
  config: BaselineConfig,
  reviews: ReviewMap = {},
  sourceKind: "citation" | "search" = "citation",
) {
  const answers = tasks.filter(
    (t) => ["succeeded", "partial"].includes(t.status) && !!t.answer?.trim(),
  );
  const sourcesEligible = answers.filter(
    (t) =>
      t.status === "succeeded" &&
      ["extracted", "none"].includes(t.source_status || ""),
  );
  const websiteMap = new Map<string, number>(),
    structures = Object.fromEntries(
      structureNames.map((k) => [k, 0]),
    ) as Record<string, number>;
  const coverage = Object.fromEntries(
    structureNames.map((k) => [k, 0]),
  ) as Record<string, number>;
  let totalSources = 0,
    ranked = 0,
    notApplicable = 0;
  const target = config.brands[0].name,
    sentiment = {
      positive: 0,
      neutral: 0,
      negative: 0,
      mixed: 0,
      unreviewed: 0,
      notMentioned: 0,
    };
  const rows = answers.map((t) => {
    const mentions = config.brands.map((b) => ({
      name: b.name,
      count: occurrences(t.answer!, [b.name, ...b.aliases]),
    }));
    const review = reviews[String(t.id)];
    const top3 = review?.rankingNotApplicable
      ? null
      : (review?.top3 ?? automaticRanking(t.answer!, config));
    if (review?.rankingNotApplicable) notApplicable++;
    else if (top3 !== null) ranked++;
    const targetMentioned = mentions[0].count > 0;
    if (!targetMentioned) sentiment.notMentioned++;
    else if (review?.target === target && review.sentiment)
      sentiment[review.sentiment]++;
    else sentiment.unreviewed++;
    const parts = structureBreakdown(t);
    for (const name of structureNames) {
      structures[name] += parts[name];
      if (parts[name] > 0) coverage[name]++;
    }
    return {
      id: t.id,
      answer: t.answer!,
      batchId: t.batch_id,
      questionId: t.question_id,
      question: t.question_text,
      platform: t.platform,
      time: t.finished_at || t.started_at,
      status: t.status,
      mentions,
      top3,
      rankingMethod: review?.rankingNotApplicable
        ? "not_applicable"
        : review?.top3 !== undefined && review.top3 !== null
          ? "manual"
          : top3 !== null
            ? "explicit_list"
            : "unjudged",
      sentiment:
        targetMentioned && review?.target === target ? review.sentiment : null,
      targetMentioned,
      review: review || null,
      structure: parts,
    };
  });
  for (const t of sourcesEligible) {
    const unique = new Map(
      t.sources
        .filter((s) => s.kind === sourceKind)
        .map((s) => [canonicalSource(s.url), s]),
    );
    for (const s of unique.values()) {
      const host = website(s.url);
      websiteMap.set(host, (websiteMap.get(host) || 0) + 1);
      totalSources++;
    }
  }
  const totalMentions = rows.reduce(
      (sum, r) => sum + r.mentions.reduce((s, b) => s + b.count, 0),
      0,
    ),
    totalChars = Object.values(structures).reduce((a, b) => a + b, 0);
  const brands = config.brands.map((b) => {
    const mentioned = rows.filter(
      (r) => r.mentions.find((m) => m.name === b.name)!.count > 0,
    ).length;
    const mentions = rows.reduce(
      (sum, r) => sum + r.mentions.find((m) => m.name === b.name)!.count,
      0,
    );
    const top3Count = rows.filter((r) => r.top3?.includes(b.name)).length;
    return {
      name: b.name,
      mentioned,
      mentions,
      mentionRate: answers.length ? mentioned / answers.length : null,
      voiceShare: totalMentions ? mentions / totalMentions : null,
      top3Count,
      top3Rate: ranked ? top3Count / ranked : null,
    };
  });
  return {
    config,
    sourceKind,
    scope: {
      records: tasks.length,
      answers: answers.length,
      sourceAnswers: sourcesEligible.length,
      excluded: tasks.length - answers.length,
      sourceExcluded: answers.length - sourcesEligible.length,
      totalSources,
      totalMentions,
      ranked,
      rankUnjudged: answers.length - ranked - notApplicable,
      rankNotApplicable: notApplicable,
      target,
    },
    brands,
    websites: [...websiteMap]
      .map(([site, count]) => ({
        site,
        count,
        share: totalSources ? count / totalSources : 0,
      }))
      .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site)),
    structures: structureNames.map((name) => ({
      name,
      characters: structures[name],
      share: totalChars ? structures[name] / totalChars : null,
      answers: coverage[name],
      coverage: answers.length ? coverage[name] / answers.length : null,
    })),
    sentiment,
    rows,
    generatedAt: new Date().toISOString(),
  };
}
export type BaselineReport = ReturnType<typeof buildBaseline>;
