# seegeo
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
用户确认：Node.js 24、TypeScript、Playwright、SQLite、React。本机服务，仅监听回环地址。

## Users
维护不到 100 个固定问题的个人用户，在自己的 Mac 上观察三家 AI 平台的回答和引用随时间怎样变化。

## Product Purpose
归档豆包、DeepSeek、腾讯元宝官方网页版的真实回答和可见来源，支持跨平台、跨日期核对。

## Operating Context
手动启动服务、浏览器打开中文面板。专用 Chrome 窗口人工登录和处理验证。默认每周一北京时间 09:00，时间和频率可改；漏采只补最近一轮。

## Capabilities and Constraints
独立纯文本问题，多行文本/CSV 导入；每题每平台一次、新对话、默认主模型、DeepSeek 显式联网、豆包与元宝允许平台自动联网并记录实际情况、思考关。问题列表为主，正文差异及来源增减优先。CSV/JSON 导出，文本历史长期保存，异常证据保留 30 天。第一版不做品牌分析或来源全文采集。先验证三平台真实采集，再扩展面板。

## Brand Commitments
名称 seegeo。中文、具体、克制的操作说明。界面用于维护问题和阅读长回答，Mac 桌面优先。界面采用 Finder、邮件、系统设置一类的浅灰侧栏、白色工作区、系统字体和蓝色主操作。

## Evidence on Hand
已完成三平台真实采集验证。2026-10-26 已以独立测试数据库验证各平台提交后暂停继续、取消及重跑。实际业务批次仍暂停。测试场景不代表完整业务批次或长期成功率。

## Product Principles
- 回答必须属于当前问题和当前会话。
- 无来源与来源提取失败必须区分。
- 保留原始内容及实际采集时间。
- 准确性和任务恢复优先于吞吐。
