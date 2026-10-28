import { buildBaseline, canonicalSource, website, type BaselineConfig, type ReviewMap } from './baseline.js';
import type { Task } from './types.js';

export interface PublicationLink { channel: string; url: string; aliases: string[] }

/** Match configured target names in the original question, including normalized aliases. */
export function hasTargetBrand(question: string, config: BaselineConfig): boolean {
  const text = question.normalize('NFKC').toLowerCase();
  return [config.brands[0].name, ...config.brands[0].aliases].some(name => {
    const term = name.normalize('NFKC').toLowerCase();
    let index = text.indexOf(term);
    while (index >= 0) {
      const left = text[index - 1] || '', right = text[index + term.length] || '';
      if (!(/^[a-z0-9]/.test(term) && /[a-z0-9]/.test(left)) && !(/[a-z0-9]$/.test(term) && /[a-z0-9]/.test(right))) return true;
      index = text.indexOf(term, index + 1);
    }
    return false;
  });
}

/** Report one platform, retaining separate denominators for brand and source metrics. */
export function calculateRoundPlatform(tasks: Task[], config: BaselineConfig, links: PublicationLink[], reviews: ReviewMap = {}) {
  const eligible = tasks.filter(t => ['succeeded', 'partial'].includes(t.status) && !!t.answer?.trim());
  const brandAnswers = eligible.filter(t => !hasTargetBrand(t.question_text, config));
  const brand = buildBaseline(brandAnswers, config, reviews);
  const publicationUrls = new Set(links.flatMap(link => [link.url, ...link.aliases]).map(canonicalSource));
  const sourceAnswers = eligible.filter(t => t.status === 'succeeded' && ['extracted','none'].includes(t.source_status || ''));
  const sources = Object.fromEntries((['citation','search'] as const).map(kind => {
    let total = 0, published = 0;
    const sites = new Map<string, number>();
    for (const t of sourceAnswers) {
      const unique = new Map(t.sources.filter(s => s.kind === kind).map(s => [canonicalSource(s.url), s]));
      for (const [url, source] of unique) {
        total++; if (publicationUrls.has(url)) published++;
        const host = website(source.url); sites.set(host, (sites.get(host) || 0) + 1);
      }
    }
    return [kind, { total, published, share: total ? published / total : null, websites: [...sites].map(([site,count]) => ({site,count,share:count / total})).sort((a,b) => b.count - a.count || a.site.localeCompare(b.site)) }];
  }));
  return { expected: tasks.length, completed: eligible.length, brandSamples: brandAnswers.length,
    sourceMissing: eligible.length - sourceAnswers.length, ranked: brand.scope.ranked,
    rankUnjudged: brand.scope.rankUnjudged, rankNotApplicable: brand.scope.rankNotApplicable,
    target: brand.brands[0], sources };
}
