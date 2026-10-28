import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoundPlatform, hasTargetBrand } from '../server/round-baseline.js';
import type { Task } from '../server/types.js';
const config = { brands: [{name:'鑫君威',aliases:['XJW']},{name:'三棵树',aliases:[]}] };
const source = (url:string, kind:'citation'|'search') => ({url,kind,title:'文章',site:'example.com',order:1,snippet:''});
const task = (question:string, answer:string, sources:Task['sources']=[]) => ({question_text:question,answer,answer_html:'',status:'succeeded',source_status:'extracted',sources}) as Task;
test('品牌指标排除目标品牌问题，不排除竞品问题，来源仍统计全部题目', () => {
  const tasks = [task('鑫君威怎么样？','鑫君威鑫君威', [source('https://example.com/a?utm_source=x','citation')]), task('三棵树怎么样？','鑫君威 三棵树 三棵树', [source('https://example.com/a','citation'), source('https://example.com/a#anchor','citation')])];
  const result=calculateRoundPlatform(tasks,config,[{channel:'官网',url:'https://example.com/a',aliases:[]}]);
  assert.equal(result.brandSamples,1); assert.equal(result.target.mentionRate,1); assert.equal(result.target.voiceShare,1/3);
  assert.equal(result.sources.citation.total,2);assert.equal(result.sources.citation.published,2);assert.equal(result.sources.search.share,null);
  assert.equal(hasTargetBrand('关于 xjw 的问题',config),true); assert.equal(hasTargetBrand('prefixjwplus',config),false);
});
test('来源不完整不纳入来源分母，但完整正文计入品牌指标', () => {
  const partial={...task('怎么选？','鑫君威',[source('https://example.com/a','search')]),status:'partial',source_status:'failed'} as Task;
  const r=calculateRoundPlatform([partial],config,[]);assert.equal(r.brandSamples,1);assert.equal(r.sourceMissing,1);assert.equal(r.sources.search.share,null);
});
