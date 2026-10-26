# 架构与维护

## 数据流

React 本机面板 → Fastify API → SQLite 持久队列 → 串行 worker → 平台适配器 → 持久 Chrome profile → 回答、来源及实际模式 → SQLite → 阅读、差异、CSV/JSON。

`server/collector.ts` 负责网页状态验证、模式设置、输入原文核对、生成完成确认及来源提取。三平台共用任务协议，但选择器与来源解析独立。页面变更时先用少量问题验证；不能新增 `body.innerText` 作为回答回退。

豆包通过回答区 `data-testid`、生成状态和复制操作确认正文；搜索步骤展开后读取列表，正文引用卡片打开目标标签以取得 URL。DeepSeek 使用独立 assistant 正文区域、思考/搜索 `aria-pressed` 状态以及完成操作栏。元宝用 human/ai 角色属性、输出状态、完成标记和引用面板 `data-url` 区分问题、回答和来源。

## 存储与调度

SQLite WAL；questions 维护当前问题，tasks 保存批次内的问题版本快照、状态、提交阶段、回答、来源 JSON、实际模式和会话地址。batches 保存触发来源、计划与实际时间；settings、events、validations 分别保存配置、可见事件和平台核对状态。数据库 schema version 为 1。

队列任务状态与网页提交阶段分别持久化。启动恢复：提交前中断可重新排队；提交过程中或生成期间中断标为 uncertain，必须核对原会话。重采创建新任务，不覆盖原结果。

调度依据固定 Asia/Shanghai 日历槽计算最近计划时点，不用“运行结束再 sleep 一周”。调度游标与批次创建在事务中保存。单一监听端口防止同一服务重复运行；不要用不同端口启动两个服务并指向同一数据目录。

仅监听 127.0.0.1，校验 Host 和修改请求的同源 token。浏览器登录态放在受本机数据目录权限保护的 profile 中，不进入应用配置或仓库。面板解析保存的 HTML 仅生成阅读文本，不执行其脚本或直接插入原始 HTML。

## 本机接口

| 接口 | 用途 |
| --- | --- |
| GET `/api/state` | 状态、计划、批次、平台核对和修改请求 token |
| GET `/api/questions`、GET `/api/questions/:id` | 当前问题列表及包含归档问题的详情 |
| POST `/api/questions/import` | `{content,format: text/csv,group}` 批量导入 |
| PATCH/DELETE `/api/questions/:id` | 编辑、启停、移出问题库 |
| POST `/api/batches` | `{platforms,questionIds?}` 创建手动任务 |
| GET `/api/results`、GET `/api/results/:id` | 平台、问题、批次、状态及时间筛选 |
| POST `/api/pause`、POST `/api/resume` | 暂停与继续 |
| POST `/api/platforms/:platform/login` | 打开独立登录窗口 |
| POST `/api/platforms/:platform/resume` | 登录/验证处理完成；不自动重发 uncertain 任务 |
| POST `/api/tasks/:id/recover`、`/retry` | 原会话恢复或明确另开对话重采 |
| PATCH `/api/settings` | 调度、自动联网口径和通知 |
| GET `/api/export/answers.csv`、`sources.csv`、`results.json` | 导出全部或筛选结果 |

修改请求需 `X-Seegeo-Token`（从本机 `/api/state` 取得），GET API 不跨域开放。平台 ID 为 doubao、deepseek、yuanbao。JSON 导出 `schemaVersion: 1`。

## 故障定位

先看面板事件、任务错误及异常截图，再打开原会话检查。只有确认选择器、当前问题归属、完成信号与来源列表都正确后，才将该平台标为验证通过。

`npm run probe -- login all` 是开发用验证工具，会占用同样的浏览器 profile；正式服务退出后才能使用。诊断文件仅保存在本机。Chrome 用户目录被占用时关闭另一个 seegeo/probe 进程；不要删除自己的日常 Chrome 数据目录。

变更接口、状态或来源结构时，同时更新 types、数据库迁移、导出及测试；日志中不记录密码、Cookie、验证码或浏览器存储内容。
