import { Store } from './store.js';
import { calculateRoundPlatform, type PublicationLink } from './round-baseline.js';
import { defaultBaselineConfig, type BaselineConfig, type ReviewMap } from './baseline.js';
import type { Task } from './types.js';

type LinkedTask = Task & { source_task_id: number | null; deleted_at: string | null };
export function roundTasks(store: Store, root: number) {
  const rootBatch = store.batch(root);
  if (!rootBatch || ['retry','bulk_retry'].includes(String(rootBatch.trigger))) throw new Error('请选择原始监测批次或整轮重跑批次');
  const batches = store.batches();
  const all = store.tasks({includeDeleted:true}) as LinkedTask[];
  const byId = new Map(all.map(t => [t.id,t]));
  const rootFor = (task: LinkedTask): number | null => {
    const seen = new Set<number>(); let cur: LinkedTask | undefined = task;
    while (cur) {
      if (seen.has(cur.id)) return null; seen.add(cur.id);
      if (cur.source_task_id) { cur = byId.get(cur.source_task_id); continue; }
      const batch = batches.find(b => b.id === cur!.batch_id);
      if (!batch) return null;
      if (batch.trigger === 'retry' && batch.parent_batch_id) {
        const parent = all.find(t => t.batch_id === batch.parent_batch_id && t.question_id === cur!.question_id && t.question_version === cur!.question_version && t.platform === cur!.platform);
        if (!parent) return null; cur = parent; continue;
      }
      if (batch.trigger === 'bulk_retry') return null;
      return Number(batch.id);
    }
    return null;
  };
  const base = all.filter(t => t.batch_id === root);
  const members = all.filter(t => rootFor(t) === root);
  const rows = base.map(original => {
    const candidates = members.filter(t => t.question_id === original.question_id && t.question_version === original.question_version && t.platform === original.platform && !t.deleted_at).sort((a,b) => b.id-a.id);
    return candidates.find(t => ['succeeded','partial'].includes(t.status) && t.answer?.trim()) || candidates[0] || original;
  });
  return {rootBatch, rows};
}
export function publicationLinks(store: Store): (PublicationLink & {id:number;channelId:number})[] {
  return store.db.prepare('SELECT l.id,l.channel_id,c.name,l.url,l.aliases FROM publication_links l JOIN publication_channels c ON c.id=l.channel_id ORDER BY l.id DESC').all().map(r => ({id:Number(r.id),channelId:Number(r.channel_id),channel:String(r.name),url:String(r.url),aliases:JSON.parse(String(r.aliases))}));
}
export function previewRound(store: Store, root: number) {
  const {rootBatch,rows}=roundTasks(store,root);
  const config=store.getSetting<BaselineConfig>('baselineConfig') || defaultBaselineConfig;
  const reviews=Object.fromEntries(store.db.prepare('SELECT task_id,payload FROM baseline_reviews').all().map(r=>[String(r.task_id),JSON.parse(String(r.payload))])) as ReviewMap;
  const links=publicationLinks(store);
  const platforms=[...new Set(rows.map(t=>t.platform))].map(platform=>{
    const tasks=rows.filter(t=>t.platform===platform);const times=tasks.filter(t=>t.answer && ['succeeded','partial'].includes(t.status)).map(t=>t.finished_at||t.started_at).filter((x):x is string=>!!x).sort();
    return {platform,first:times[0]||null,last:times.at(-1)||null,...calculateRoundPlatform(tasks,config,links,reviews)};
  });
  return {rootBatch,config,links,platforms,scope:rows.map(t=>({questionId:t.question_id,version:t.question_version,platform:t.platform,answer:!!t.answer?.trim() && ['succeeded','partial'].includes(t.status),sources:t.status==='succeeded' && ['extracted','none'].includes(t.source_status||'')})).sort((a,b)=>a.questionId-b.questionId || a.platform.localeCompare(b.platform)),taskIds:rows.map(t=>t.id),reviews:Object.fromEntries(rows.filter(t=>reviews[String(t.id)]).map(t=>[String(t.id),reviews[String(t.id)]])),generatedAt:new Date().toISOString()};
}
