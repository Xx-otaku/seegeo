# 架构与维护

## 数据流

React 本机面板 → Fastify API → SQLite 持久队列 → 串行 worker → 平台适配器 → 持久 Chrome profile → 回答、来源及实际模式 → SQLite → 阅读、差异、CSV/JSON。

`server/collector.ts` 负责网页状态验证、模式设置、输入原文核对、生成完成确认及来源提取。三平台共用任务协议，但选择器与来源解析独立。页面变更时先用少量问题验证；不能新增 `body.innerText` 作为回答回退。

豆包通过回答区 `data-testid`、生成状态和复制操作确认正文；搜索步骤展开后读取列表，正文引用卡片打开目标标签以取得 URL。DeepSeek 使用独立 assistant 正文区域、思考/搜索 `aria-pressed` 状态以及完成操作栏。元宝用 human/ai 角色属性、输出状态、完成标记和引用面板 `data-url` 区分问题、回答和来源。

## 存储与调度

SQLite WAL；questions 维护当前问题，tasks 保存批次内的问题版本快照、状态、提交阶段、回答、来源 JSON、实际模式和会话地址。batches 保存触发来源、计划与实际时间；settings、events、validations 分别保存配置、可见事件和平台核对状态。数据库 schema version 为 2；task_attempts 保存每次采集、原会话恢复及回退重试的阶段、会话、起止时间、结果和中断原因。迁移前备份，版本迁移在事务中执行。

队列任务状态与网页提交阶段分别持久化。批次控制状态为 running、pausing、paused、waiting、cancelling、cancelled、completed；任务另有 paused、登录/验证等待及 uncertain。启动恢复会将异常中断批次保持暂停；提交过的项先恢复原会话，未提交的项可重新排队。

Runner 的控制命令使用串行 promise 队列；一个 worker 独占当前采集。暂停/取消发出 AbortSignal，guarded race 允许控制立即停止等待，阶段更新和最终写入都检查 signal。合作的暂停保留原页面和生成连接，超出短暂退出等待或取消则关闭工作标签，保留 profile。旧 promise 即使迟到也无法写回结果。当前项优先于其它 paused 和 pending 项，手动暂停不会屏蔽平台。

恢复先核对原问题，等待原回答完成、稳定且有完成信号；原会话失效时只回退一个新对话尝试。登录/验证码不触发回退。取消保留成功和部分完成项目，终止未完成项目，结束批次并清除控制残留。重跑从 tasks 快照复制矩阵，不读取当前 questions 的启用或编辑状态。单条重采也创建新批次并直接开始，旧结果不覆盖。

调度依据固定 Asia/Shanghai 日历槽计算最近计划时点，不用“运行结束再 sleep 一周”。调度游标与批次创建在事务中保存。单一监听端口防止同一服务重复运行；不要用不同端口启动两个服务并指向同一数据目录。

仅监听 127.0.0.1，校验 Host 和修改请求的同源 token。浏览器登录态放在受本机数据目录权限保护的 profile 中，不进入应用配置或仓库。面板解析保存的 HTML 仅生成阅读文本，不执行其脚本或直接插入原始 HTML。

## 本机接口

| 接口 | 用途 |
| --- | --- |
| GET `/api/state` | 状态、activeBatch/displayBatch、pausedTask/currentItem、controls 的 enabled/reason、计划及修改请求 token |
| GET `/api/questions`、GET `/api/questions/:id` | 当前问题列表及包含归档问题的详情 |
| POST `/api/questions/import` | `{content,format: text/csv,group}` 批量导入 |
| PATCH/DELETE `/api/questions/:id` | 编辑、启停、移出问题库 |
| POST `/api/questions/bulk-delete` | `{questionIds:[...]}` 批量移出，完整校验后事务更新，保留历史 |
| POST `/api/batches` | `{platforms,questionIds?}` 创建手动任务 |
| GET `/api/results`、GET `/api/results/:id` | 平台、问题、批次、状态及时间筛选 |
| POST `/api/pause`、POST `/api/resume` | 暂停与继续 |
| POST `/api/batches/:id/cancel`、`/rerun` | 直接取消或按快照新建整轮 |
| GET `/api/tasks/:id/attempts`、POST `/api/tasks/:id/open` | 尝试记录、使用对应采集登录态打开原会话 |
| POST `/api/platforms/:platform/login` | 打开独立登录窗口 |
| POST `/api/platforms/:platform/resume` | 登录/验证处理完成；按提交阶段恢复原会话或排队 |
| POST `/api/tasks/:id/recover`、`/retry` | 原会话恢复或明确另开对话重采 |
| PATCH `/api/settings` | 调度、自动联网口径和通知 |
| GET `/api/export/answers.csv`、`sources.csv`、`results.json` | 导出全部或筛选结果 |

修改请求需 `X-Seegeo-Token`（从本机 `/api/state` 取得），GET API 不跨域开放。平台 ID 为 doubao、deepseek、yuanbao。JSON 导出 `schemaVersion: 2`。

## 故障定位

先看面板事件、任务错误及异常截图，再打开原会话检查。只有确认选择器、当前问题归属、完成信号与来源列表都正确后，才将该平台标为验证通过。

`npm run probe -- login all` 是开发用验证工具，会占用同样的浏览器 profile；正式服务退出后才能使用。诊断文件仅保存在本机。Chrome 用户目录被占用时关闭另一个 seegeo/probe 进程；不要删除自己的日常 Chrome 数据目录。

变更接口、状态或来源结构时，同时更新 types、数据库迁移、导出及测试；日志中不记录密码、Cookie、验证码或浏览器存储内容。

## 基线计算与人工核对（数据库 v4）

`server/baseline.ts` 为确定性计算，不使用外部模型。`GET /api/baseline` 接受 platform/from/to/group/sourceKind，返回分母、品牌指标、网站信源份额、结构占比、情感分布及样本明细；`GET /api/baseline/export` 导出同口径 JSON。`PATCH /api/baseline/config` 更新 settings 中的品牌名和别名；`PUT /api/baseline/reviews/:id` 保存 `baseline_reviews`，包含目标品牌、情感、前三品牌、排名不适用、备注和时间。删除记录同时清理核对数据。

排名和情感的未知项单列；情感核对必须绑定当时的目标品牌，更换目标后排除旧目标的情感。批次快照与原回答不受配置变更影响。前端异步筛选使用请求序号，较旧响应不得覆盖新筛选结果。没有自动抓取来源全文，不推测事实错误、投放归属或文章来源结构。
