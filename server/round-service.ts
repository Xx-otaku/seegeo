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

/** Group original runs by their start date in Beijing; retries stay with their original run. */
export function dateRounds(store: Store) {
  return store.batches().filter(b => !['retry','bulk_retry'].includes(String(b.trigger))).map(b => ({...b,id:Number(b.id),finished_at:b.finished_at as string | null,date: new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(String(b.created_at)))}));
}
export function dateSelection(store: Store, date: string, selected?: number[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式无效');
  const batches = dateRounds(store).filter(b=>b.date===date).sort((a,b)=>Number(a.id)-Number(b.id));
  if (!batches.length) throw new Error('该日期没有监测记录');
  const visibleQuestions = new Set(store.questions().map(q=>q.id));
  const all = batches.flatMap(b=>roundTasks(store,Number(b.id)).rows).filter(t=>!t.deleted_at && visibleQuestions.has(t.question_id));
  const choices = new Map<number,Task>();
  for (const task of all) {const prev=choices.get(task.question_id);if(!prev || task.id>prev.id)choices.set(task.question_id,task);}
  const questions=[...choices.values()].map(t=>({id:t.question_id,text:t.question_text,version:t.question_version}));
  if (selected && selected.some(id=>!choices.has(id))) throw new Error('部分问题不属于该日期');
  const allowed=new Set(selected ?? questions.map(q=>q.id));
  const rows = new Map<string,Task>();
  for (const task of all.filter(t=>allowed.has(t.question_id))) {
    const key=`${task.question_id}:${task.platform}`;const prev=rows.get(key);
    const valid=(t:Task)=>['succeeded','partial'].includes(t.status)&&!!t.answer?.trim();
    const time=(t:Task)=>Date.parse(t.finished_at||t.started_at||'')||0;
    if (!prev || (valid(task)&&!valid(prev)) || (valid(task)===valid(prev) && (time(task)>time(prev) || (time(task)===time(prev)&&task.id>prev.id)))) rows.set(key,task);
  }
  const details=[...rows.values()];
  return {batches,questions:questions.map(q=>({...q,samples:details.filter(t=>t.question_id===q.id).map(t=>({platform:t.platform,time:t.finished_at||t.started_at,status:t.status}))})),rows:details};
}
export function previewDate(store: Store,date: string,ids?:number[]) {
  const {batches,questions,rows}=dateSelection(store,date,ids);
  const config=store.getSetting<BaselineConfig>('baselineConfig') || defaultBaselineConfig;
  const links=publicationLinks(store);
  const platforms=[...new Set(rows.map(t=>t.platform))].map(platform=>{
    const tasks=rows.filter(t=>t.platform===platform);const times=tasks.filter(t=>t.answer && ['succeeded','partial'].includes(t.status)).map(t=>t.finished_at||t.started_at).filter((x):x is string=>!!x).sort();
    return {platform,first:times[0]||null,last:times.at(-1)||null,...calculateRoundPlatform(tasks,config,links,{})};
  });
  return {date,rootBatch:batches[0],batches,questions,selectedQuestionIds:ids??questions.map(q=>q.id),config,links,platforms,scope:rows.map(t=>({questionId:t.question_id,version:t.question_version,platform:t.platform,answer:!!t.answer?.trim()&&['succeeded','partial'].includes(t.status),sources:t.status==='succeeded'&&['extracted','none'].includes(t.source_status||'')})).sort((a,b)=>a.questionId-b.questionId||a.platform.localeCompare(b.platform)),taskIds:rows.map(t=>t.id),generatedAt:new Date().toISOString()};
}
